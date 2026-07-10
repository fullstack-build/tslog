import type { AsyncContextFields, AsyncContextStore } from "./core/asyncContext.js";
import { createAsyncContextStore, createAsyncContextStoreFromInstance } from "./core/asyncContext.js";
import { TslogConfigError } from "./core/config.js";
import type { CoreFeatures, MaskingLike } from "./core/features.js";
import { DEFAULT_PERSIST_LEVEL_KEY, readPersistedLevel, writePersistedLevel } from "./core/levelPersistence.js";
import { resolveLogLevelId as resolveLevelId, validateCustomLevel } from "./core/levels.js";
import { type LogObjDeps, recursiveCloneAndExecuteFunctions, toLogObj } from "./core/logObj.js";
import { attachMaskedArgs, resolveFormatter, runMiddleware } from "./core/pipeline.js";
import { devWarningsEnabled, emitConfigWarning, normalizeSettings, resolveLogLevelId } from "./core/settings.js";
import { attachTransport, dispatchToTransports, disposeAll, flushAll } from "./core/transports.js";
import type { EnvironmentProvider } from "./env/environment.js";
import type {
  ILogObj,
  ILogObjMeta,
  IMeta,
  ISettings,
  ISettingsParam,
  LogContext,
  LogMiddleware,
  TCustomLevelMethod,
  TLogFormat,
  TLogLevelName,
  Transport,
  TransportFn,
} from "./interfaces.js";
import { nativeConsoleMethod } from "./internal/nativeConsole.js";
import { renderJsonUnplanned } from "./render/json.js";
import { urlToObject } from "./urlToObj.js";

export * from "./interfaces.js";

// Fallbacks for a BaseLogger constructed WITHOUT an injected feature set (direct/advanced use — every
// published entry injects one). JSON output uses the plan-free renderer (byte-identical lines) and
// masking degrades to the engine's mask-off fast path (top-level URLs still expand). Settings that NAME
// an absent subsystem are rejected loudly, per the CoreFeatures contract: silently dropping a user's
// redaction config (or their strictConfig opt-in) is an incident, not a fallback. Pass the entries'
// exported `fullCoreFeatures` as the fifth constructor argument to get the complete behavior.
const FALLBACK_FEATURES: CoreFeatures = {
  renderJson: renderJsonUnplanned,
  validateSettings<LogObj>(settings: ISettingsParam<LogObj> | undefined): void {
    if (settings == null) {
      return;
    }
    const mask = settings.mask;
    const masksSomething =
      mask != null && ((mask.keys?.length ?? 0) > 0 || (mask.regex?.length ?? 0) > 0 || (mask.paths?.length ?? 0) > 0 || mask.censor != null);
    if (masksSomething) {
      throw new TslogConfigError({
        code: "FEATURES_NO_MASKING",
        setting: "mask",
        message: "this BaseLogger was constructed without a feature set, so these mask settings would be silently ignored and secrets logged in plaintext.",
        suggestion:
          'Pass the full feature set as the fifth constructor argument: `new BaseLogger(settings, logObj, env, NaN, fullCoreFeatures)` (exported from "tslog").',
      });
    }
    if (settings.type === "pretty" || settings.pretty?.enabled === true) {
      throw new TslogConfigError({
        code: "FEATURES_NO_PRETTY",
        setting: "type",
        message: "this BaseLogger was constructed without a feature set, so pretty output would lose its meta line.",
        suggestion: "Pass the full feature set as the fifth constructor argument (`fullCoreFeatures`), or use the entry Logger classes.",
      });
    }
    if (settings.strictConfig === true) {
      throw new TslogConfigError({
        code: "FEATURES_NO_VALIDATION",
        setting: "strictConfig",
        message: "this BaseLogger was constructed without a feature set, so the strict settings validation you opted into cannot run.",
        suggestion: "Pass the full feature set as the fifth constructor argument (`fullCoreFeatures`), which includes the validator.",
      });
    }
  },
};

const IDENTITY_MASKING: MaskingLike = {
  mask(args: unknown[]): unknown[] {
    for (let i = 0; i < args.length; i++) {
      if (args[i] instanceof URL) {
        return args.map((arg) => (arg instanceof URL ? urlToObject(arg) : arg));
      }
    }
    return args;
  },
};

/**
 * The core logging pipeline (BC11 — no module-level environment singleton).
 *
 * `BaseLogger` owns the runtime-agnostic pipeline: settings normalization, the `log()` method,
 * `attachTransport`, and `getSubLogger`. Everything that depends on the runtime (stack parsing, meta
 * assembly, inspect, console transports, CSS styling) is supplied through the injected
 * {@link EnvironmentProvider}, and the masking / log-object / meta engines live in `core/*`.
 *
 * Each entry point injects its own provider:
 *  - `index.node.ts`      -> `createNodeEnvironment()`
 *  - `index.browser.ts`   -> `createBrowserEnvironment()`
 *  - `index.universal.ts` -> `selectEnvironment()` (universal provider)
 *
 * The constructor takes `(settings?, logObj?, environment, callerFrame=NaN, features?)`; `features` is
 * the runtime-agnostic subsystem composition (masking/JSON renderer/validation — see `core/features.ts`),
 * injected by every entry (`fullCoreFeatures` from the standard ones). `callerFrame` (M1.14,
 * renamed from `stackDepthLevel`) is the manual stack-frame index; `NaN` means auto-detect.
 */
export class BaseLogger<LogObj> {
  public readonly runtime: EnvironmentProvider;
  public settings: ISettings<LogObj>;
  private readonly maxErrorCauseDepth = 5;
  private readonly captureStackForMeta: boolean;
  private readonly maskingEngine: MaskingLike;
  private readonly features: CoreFeatures;
  private readonly logObjDeps: LogObjDeps;
  // Async context store (M2.13), held in a BOX shared across the whole sub-logger family (see
  // getSubLogger). The store itself is created lazily on the first `runInContext`/`getContext` so merely
  // constructing a logger never resolves `AsyncLocalStorage` — but because the box is shared, whichever
  // family member materializes it first makes the store visible to every other member, regardless of
  // creation order. The hot path only pays a null check on the box's slot.
  private asyncContextBox: { store?: AsyncContextStore } = {};
  // One warning per logger: runInContext() on a runtime without AsyncLocalStorage is a silent no-op
  // otherwise, and "my requestId never shows up" is a top support question on edge runtimes.
  private warnedContextNoop = false;
  // Transports inherited from a parent logger (set by getSubLogger). Disposing THIS logger flushes
  // everything but only disposes transports it owns — a request-scoped `await using child` must not
  // terminate the root logger's file/worker/http sinks.
  private inheritedTransports?: WeakSet<object>;
  // Whether any custom levels are registered (kept in sync by the constructor and addLevel) — gates
  // the per-call id/name drift check so default-config logging pays a single boolean test.
  private hasCustomLevels = false;
  // The pre-mask bindings as supplied by the caller; the source getSubLogger merges from (see above).
  private rawBindings?: Record<string, unknown>;
  // Cached no-op stand-in returned by `if(false)` — built lazily on first falsy conditional call so a
  // logger that never uses `if()` pays nothing. See _getConditionalNoop().
  private _conditionalNoop?: this;

  constructor(
    settings: ISettingsParam<LogObj> | undefined,
    private logObj: LogObj | undefined,
    environment: EnvironmentProvider,
    private callerFrame: number = Number.NaN,
    features?: CoreFeatures,
  ) {
    this.features = features ?? FALLBACK_FEATURES;
    this.features.validateSettings?.(settings);
    this.runtime = environment;
    // Normalize into the fully-populated settings object. The engine reads this live (never a copy),
    // so post-construction mutations (e.g. tests setting mask.keys/mask.placeholder) take effect.
    this.settings = normalizeSettings(settings);

    this.maskingEngine =
      this.features.createMaskingEngine?.(this.settings, {
        isError: (value): value is Error => this.runtime.isError(value),
        isBuffer: (value) => this.runtime.isBuffer(value),
      }) ?? IDENTITY_MASKING;
    this.logObjDeps = {
      isError: (value): value is Error => this.runtime.isError(value),
      isBuffer: (value) => this.runtime.isBuffer(value),
      getErrorTrace: (error) => this.runtime.getErrorTrace(error),
      maxErrorCauseDepth: this.maxErrorCauseDepth,
    };

    // Opt-in browser log-level persistence (M4.6): when `persistLevel` is set, seed `minLevel` from
    // localStorage so a level flipped in the devtools console survives a reload. Off-browser / when no value
    // is stored this is a guarded no-op (readPersistedLevel returns undefined), leaving the normalized level.
    if (this.settings.persistLevel === true) {
      const persisted = readPersistedLevel(this.settings.persistLevelKey ?? DEFAULT_PERSIST_LEVEL_KEY);
      if (persisted != null) {
        // The stored token is either a numeric id ("2") or a level name ("WARN"); resolve numeric strings to
        // a number first, then fall back to name resolution (which also covers custom levels).
        const asNumber = Number(persisted);
        const token: number | TLogLevelName = persisted.trim() !== "" && Number.isFinite(asNumber) ? asNumber : (persisted as TLogLevelName);
        const resolved = resolveLevelId(token, this.settings.customLevels);
        if (resolved != null) {
          this.settings.minLevel = resolved;
        }
      }
    }

    this.captureStackForMeta = this._shouldCaptureStack();

    // Bindings are static per logger: sanitize and mask them ONCE here instead of on every call.
    // `rawBindings` keeps the pre-mask values so getSubLogger can merge WITHOUT re-masking the
    // parent's already-masked values (a "hash"/function censor is not idempotent — re-masking would
    // corrupt correlation tokens on every sub-logger generation).
    if (this.settings.bindings != null) {
      this.rawBindings = { ...this.settings.bindings };
      this._sanitizeBindings(this.settings.bindings);
      this.settings.bindings = this.maskingEngine.mask([this.settings.bindings])[0] as Record<string, unknown>;
    }

    // Install a real level method for every registered custom level (logger.audit(...) etc.).
    for (const [name, id] of Object.entries(this.settings.customLevels)) {
      this.hasCustomLevels = true;
      this._installCustomLevelMethod(name, id);
    }

    // An INJECTED contextStorage is materialized eagerly (there is nothing to lazily resolve — the
    // instance already exists): the hot path reads asyncContextBox.store, so a context entered via the
    // instance's own `als.run(...)` (outside runInContext) must be visible from the very first log call.
    if (this.settings.contextStorage != null) {
      this.asyncContextBox.store = createAsyncContextStoreFromInstance(this.settings.contextStorage);
    }
  }

  /**
   * Define `this[name.toLowerCase()](...)` for a registered custom level so call sites stop repeating
   * the (id, name) pair. A name whose lower-cased form collides with an existing logger member (e.g.
   * "flush", "info") is NOT installed — the level still works via `log(id, name, ...)` — and a dev
   * warning explains why.
   */
  private _installCustomLevelMethod(name: string, id: number): void {
    const methodName = name.toLowerCase();
    const existing = (this as unknown as Record<string, unknown>)[methodName];
    // Refuse to clobber ANY existing member (methods like "flush", but also fields like "settings" or
    // "runtime") unless it is a custom-level method we installed ourselves (re-registration).
    if (existing !== undefined && (existing as { __tslogCustomLevel?: string })?.__tslogCustomLevel === undefined) {
      // Defensive only: validateCustomLevel already rejects the known-reserved lowercase members.
      if (devWarningsEnabled()) {
        emitConfigWarning(
          `custom level "${name}" collides with the existing logger member "${methodName}"; no method was installed — use log(${id}, ${JSON.stringify(name)}, ...) instead.`,
        );
      }
      return;
    }
    const method = (...args: unknown[]): unknown => this.log(id, name, ...args);
    (method as unknown as { __tslogCustomLevel: string }).__tslogCustomLevel = name;
    Object.defineProperty(this, methodName, {
      value: method,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  /**
   * Drop binding keys that would corrupt the record shape: a key equal to the configured message key
   * or meta property hijacks message promotion, and an integer-like key gets hoisted by JS object
   * enumeration (and permanently bails the precompiled JSON line plan). Warns in development.
   */
  private _sanitizeBindings(bindings: Record<string, unknown>): void {
    for (const key of Object.keys(bindings)) {
      const integerLike = /^(?:0|[1-9]\d*)$/.test(key);
      if (key === this.settings.json.messageKey || key === this.settings.meta.property || key === "__proto__" || integerLike) {
        delete bindings[key];
        if (devWarningsEnabled()) {
          emitConfigWarning(
            `binding "${key}" was dropped: ${integerLike ? "integer-like keys are hoisted by JS object semantics" : "it collides with a reserved record key"} — rename the binding.`,
          );
        }
      }
    }
  }

  /**
   * Set this logger's minimum level at runtime (M4.6). Accepts a numeric id, the
   * {@link import("./interfaces.js").LogLevel} enum, or a level name (a default like `"WARN"` or a
   * registered custom level like `"NOTICE"`), resolved the same way `minLevel` is. An unknown level name is
   * ignored (the level is left unchanged). Works on every runtime.
   *
   * When {@link import("./interfaces.js").ISettingsParam.persistLevel} is enabled and running in a browser,
   * the new level is also written to `localStorage` (guarded; a no-op off-browser) so it survives a reload.
   *
   * @returns this logger, for chaining.
   * @example logger.setMinLevel("WARN");   // or logger.setMinLevel(4)
   */
  public setMinLevel(level: number | TLogLevelName): this {
    const resolved = resolveLevelId(level, this.settings.customLevels);
    if (resolved == null) {
      return this;
    }
    this.settings.minLevel = resolved;
    if (this.settings.persistLevel === true) {
      writePersistedLevel(resolved, this.settings.persistLevelKey ?? DEFAULT_PERSIST_LEVEL_KEY);
    }
    return this;
  }

  /**
   * Logs a message with a custom log level.
   * @param logLevelId    - Log level ID e.g. 0
   * @param logLevelName  - Log level name e.g. silly
   * @param args          - Multiple log attributes that should be logged out.
   * @return LogObject with meta property, when log level is >= minLevel
   */
  public log(logLevelId: number, logLevelName: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    // Below-minLevel short-circuit: allocation-free, the args are never touched.
    if (logLevelId < this.settings.minLevel) {
      return;
    }

    // A registered custom level called with a drifting id (log(3, "AUDIT") while AUDIT is 8) is
    // almost certainly a bug — warn in development. One property read when custom levels exist.
    if (this.hasCustomLevels) {
      const registered = this.settings.customLevels[logLevelName];
      if (registered !== undefined && registered !== logLevelId && devWarningsEnabled()) {
        emitConfigWarning(`log(${logLevelId}, ${JSON.stringify(logLevelName)}) does not match the registered id ${registered} for that custom level.`);
      }
    }

    const resolvedArgs = this._resolveLogArguments(args);
    // Skip the spread when there is no prefix — `args` is this call's own rest array, safe to pass on.
    let logArgs = this.settings.prefix.length > 0 ? [...this.settings.prefix, ...resolvedArgs] : resolvedArgs;

    // Middleware chain (replaces the v4 overwrite.* hooks): runs in registration order over a mutable
    // context. Any middleware may rewrite args/level/meta or drop the log entirely (return null/false).
    // The context object is only built when middleware are registered, so the common no-middleware
    // log pays no allocation here.
    let effectiveLevelId = logLevelId;
    let effectiveLevelName = logLevelName;
    let middlewareMeta: Record<string, unknown> | undefined;
    if (this.settings.middleware.length > 0) {
      const context: LogContext<LogObj> | null = runMiddleware(
        {
          logLevelId,
          logLevelName,
          args: logArgs,
          settings: this.settings,
          meta: {},
        },
        this.settings.middleware,
      );
      if (context == null) {
        return;
      }
      effectiveLevelId = context.logLevelId;
      effectiveLevelName = context.logLevelName;
      logArgs = context.args;
      middlewareMeta = context.meta;
    }

    // Mask / normalize the (possibly middleware-rewritten) args through the masking engine.
    const maskedArgs: unknown[] = this.maskingEngine.mask(logArgs);

    // Execute default LogObj functions for every log (e.g. requestId), then build the flat log object.
    const thisLogObj: LogObj | undefined = this.logObj != null ? recursiveCloneAndExecuteFunctions(this.logObj) : undefined;
    const logObj: LogObj = toLogObj(maskedArgs, this.settings.argumentsArrayName, this.logObjDeps, thisLogObj, this.settings.bindings);

    // Attach the runtime _logMeta block (incl. v: 5 via the JSON renderer) to produce the finished record.
    const record: LogObj & ILogObjMeta = this._addMetaToLogObj(logObj, effectiveLevelId, effectiveLevelName);

    // Any middleware-stashed meta fields are merged onto the record's _logMeta block so a later format stage
    // (or a transport) can read trace/correlation data the middleware attached.
    const recordMeta = record[this.settings.meta.property] as IMeta | undefined;
    if (recordMeta != null) {
      // Auto-attach the active async context's fields (M2.13) FIRST, so explicit middleware-stashed meta
      // (set this call) takes precedence over inherited context fields on a key collision.
      if (this.settings.meta.attachContext) {
        const activeContext = this.asyncContextBox.store?.getStore();
        if (activeContext != null) {
          for (const key of Object.keys(activeContext)) {
            (recordMeta as unknown as Record<string, unknown>)[key] = activeContext[key];
          }
        }
      }
      if (middlewareMeta != null) {
        for (const key of Object.keys(middlewareMeta)) {
          (recordMeta as unknown as Record<string, unknown>)[key] = middlewareMeta[key];
        }
      }
    }

    // Expose the masked args to the pretty format stage (tslog inspects the ARGS for pretty output, not
    // the reshaped record). Non-enumerable, so it never leaks into JSON output or spreads.
    attachMaskedArgs(record, maskedArgs);

    // Single console path (no overwrite branching): pretty -> live console transport (with browser CSS);
    // json -> the flat fields-first line; hidden -> no console output (transports still run).
    if (this.settings.type === "pretty") {
      const { args: prettyArgs, errors: prettyErrors } = this.runtime.prettyFormatLogObj(maskedArgs, this.settings);
      /* v8 ignore next -- FALLBACK_FEATURES rejects pretty without a full feature set (FEATURES_NO_PRETTY), so no live logger reaches this "" fallback */
      const metaMarkup = this.features.buildPrettyMetaText?.(this.settings, recordMeta) ?? "";
      this.runtime.transportFormatted(metaMarkup, prettyArgs, prettyErrors, recordMeta, this.settings);
    } else if (this.settings.type === "json") {
      try {
        const line = this.features.renderJson(record, this.settings);
        // The runtime's default sink when it has one (Node: batched fd-1 writes), console otherwise.
        if (this.runtime.writeJsonLine != null) {
          this.runtime.writeJsonLine(line);
        } else {
          nativeConsoleMethod("log")(line);
        }
      } catch {
        // never let the default sink crash logging
      }
    }

    // Attached transports: each gated by its own minLevel and formatted per its own `format` (lazily,
    // shared across transports that request the same format), every transport isolated in try/catch.
    if (this.settings.attachedTransports.length > 0) {
      // Format-less transports follow the logger's type; `hidden` (the "transports own the output"
      // production pattern) defaults to the structured json line, as documented in core/transports.
      const defaultFormat: TLogFormat<LogObj> = this.settings.type === "pretty" ? "pretty" : "json";
      dispatchToTransports(
        this.settings.attachedTransports,
        record,
        effectiveLevelId,
        defaultFormat,
        (rec, format) => resolveFormatter<LogObj>(format, this.runtime, this.features.renderJson)(rec, this.settings),
        this.settings.customLevels,
      );
    }

    return record;
  }

  /**
   * Whether a log at `level` would be emitted by this logger (E4) — i.e. its resolved id is `>=`
   * `this.settings.minLevel`. Accepts a numeric id, the {@link import("./interfaces.js").LogLevel}
   * enum, or a level name (a default like `"WARN"` or a registered custom level like `"NOTICE"`), resolved
   * the same way `minLevel` is. An unknown level name returns `false`. Use this to guard expensive payload
   * construction before logging.
   *
   * @example
   * if (logger.isLevelEnabled("DEBUG")) logger.debug({ snapshot: serializeExpensiveState() });
   */
  public isLevelEnabled(level: number | TLogLevelName): boolean {
    const resolved = resolveLevelId(level, this.settings.customLevels);
    if (resolved == null) {
      return false;
    }
    return resolved >= this.settings.minLevel;
  }

  /**
   * Conditional-logging gate (issue #299). Returns this logger when `condition` is truthy, or a no-op
   * stand-in when it is falsy, so a per-call condition reads as a fluent chain without an `if` statement
   * or a throwaway helper:
   *
   * @example
   * logger.if(!ok).info("action failed", { id });
   * logger.if(retries > maxRetries).warn("giving up", { retries });
   *
   * The no-op stand-in accepts every level method (defaults and custom) and returns `undefined` from
   * each — matching a real log call's `undefined` return when it is below `minLevel` — but its arguments
   * are still evaluated, so guard *expensive* payload construction with {@link isLevelEnabled} instead,
   * which short-circuits before the arguments are built. `if()` gates a single log call; it is not meant
   * to be chained ahead of `getSubLogger`/`child`.
   */
  public if(condition: unknown): this {
    return condition ? this : (this._getConditionalNoop() as this);
  }

  /**
   * Lazily build (and cache) the no-op stand-in returned by {@link if} for a falsy condition. A Proxy so
   * it covers every current and future method — default levels, `addLevel()` levels — uniformly: any
   * property resolves to a function that ignores its arguments and returns `undefined`, exactly like a
   * suppressed log call.
   */
  private _getConditionalNoop(): this {
    if (this._conditionalNoop == null) {
      const noopMethod = (): undefined => undefined;
      this._conditionalNoop = new Proxy(this, {
        get(target, prop, receiver): unknown {
          // Preserve Promise/thenable semantics: never fabricate a `then`, so awaiting the stand-in
          // (or feeding it to Promise.resolve) doesn't hang or resolve unexpectedly.
          if (prop === "then") {
            return undefined;
          }
          // Non-method properties (e.g. `settings`) read through to the real logger so introspection
          // still works; anything callable becomes an argument-ignoring no-op returning `undefined`.
          const actual = Reflect.get(target, prop, receiver);
          return typeof actual === "function" ? noopMethod : actual;
        },
      }) as this;
    }
    return this._conditionalNoop;
  }

  /**
   * Append a {@link LogMiddleware} to this logger's chain. Middleware run in registration order on every
   * log before the record is built, and may enrich/rewrite the {@link LogContext} or drop the log (return
   * `null`/`false`). The replacement for the removed `overwrite.*` hooks.
   *
   * @returns this logger, for chaining.
   * @example
   * logger.use((ctx) => { ctx.meta.traceId = getTraceId(); return ctx; });
   */
  public use(middleware: LogMiddleware<LogObj>): this {
    this.settings.middleware.push(middleware);
    return this;
  }

  /**
   * Lazily resolve this logger's {@link AsyncContextStore} (M2.13), creating it on first use so merely
   * constructing a logger never touches `AsyncLocalStorage`. Sub-loggers share their parent's store.
   */
  private _getAsyncContextStore(): AsyncContextStore {
    if (this.asyncContextBox.store == null) {
      if (this.settings.contextStorage != null) {
        // A user-injected AsyncLocalStorage instance (the Cloudflare Workers `nodejs_als` seam) wins
        // over automatic resolution.
        this.asyncContextBox.store = createAsyncContextStoreFromInstance(this.settings.contextStorage);
      } else {
        // Prefer the runtime provider's resolver (Node resolves via createRequire); fall back to the core
        // global/builtin probe. Either yields a graceful no-op store where AsyncLocalStorage is unavailable.
        this.asyncContextBox.store = this.runtime.createAsyncContextStore != null ? this.runtime.createAsyncContextStore() : createAsyncContextStore();
      }
    }
    return this.asyncContextBox.store;
  }

  /**
   * Run `fn` with `ctx` as the active async context (M2.13). For the (possibly async) duration of `fn`, the
   * fields in `ctx` are attached onto every log's `_logMeta` (unless `meta.attachContext` is `false`) and are
   * readable via {@link getContext} — across `await`, timers, promise chains, and nested `runInContext`
   * calls (nested contexts inherit and shallow-merge over the parent). Returns whatever `fn` returns.
   *
   * On runtimes without `AsyncLocalStorage` (browsers/edge) this gracefully degrades: `fn` still runs, but
   * no context is propagated. Never throws on account of an unavailable store.
   *
   * @example
   * await logger.runInContext({ requestId: req.id }, async () => {
   *   logger.info("handling");           // _logMeta.requestId === req.id
   *   await doWork();                    // still in context after the await
   * });
   */
  public runInContext<T>(ctx: AsyncContextFields, fn: () => T): T {
    const store = this._getAsyncContextStore();
    if (!store.enabled && !this.warnedContextNoop && devWarningsEnabled()) {
      this.warnedContextNoop = true;
      nativeConsoleMethod("warn")(
        "tslog: runInContext() found no AsyncLocalStorage on this runtime — the function runs, but the context will NOT be attached to logs. " +
          'On Cloudflare Workers enable the "nodejs_als" (or "nodejs_compat") compatibility flag and pass `contextStorage: new AsyncLocalStorage()` from "node:async_hooks".',
      );
    }
    return store.run(ctx, fn);
  }

  /**
   * Return the fields of the currently active async context (set by an enclosing {@link runInContext}), or
   * `undefined` when there is none / the runtime has no `AsyncLocalStorage`. The otel preset can consume
   * this as its trace-context getter, e.g. `otelFormat({ getSpanContext: () => logger.getContext() })`.
   */
  public getContext(): AsyncContextFields | undefined {
    return this._getAsyncContextStore().getStore();
  }

  /**
   * Register an additive custom log level (M2.14) at runtime: maps `name → id` for this logger so a
   * subsequent `log(id, name, ...)` emits the right `logLevelId`/`logLevelName` and a string `minLevel`
   * (e.g. `"NOTICE"`) resolves against it. The canonical seven names keep working; a name colliding with a
   * default level throws. Mutates this logger's resolved settings and returns `this` for chaining.
   *
   * Also installs a real level method named after the lower-cased level, so call sites stop
   * repeating the (id, name) pair — and returns `this` typed with that method.
   *
   * @example logger.addLevel("NOTICE", 3.5).notice("heads up");
   */
  public addLevel<Name extends string>(name: Name, id: number): string extends Name ? this : this & Record<Lowercase<Name>, TCustomLevelMethod<LogObj>> {
    validateCustomLevel(name, id, this.settings.customLevels);
    this.settings.customLevels[name] = id;
    this.hasCustomLevels = true;
    this._installCustomLevelMethod(name, id);
    return this as string extends Name ? this : this & Record<Lowercase<Name>, TCustomLevelMethod<LogObj>>;
  }

  /**
   *  Attaches an external output sink (e.g. a log service, file system, database). Accepts a full
   *  {@link Transport} or a bare {@link TransportFn} (which is wrapped into a `Transport` with no flush).
   *
   * @param transport - the transport (or plain function) to attach.
   * @returns a detach function that removes this transport on first call (idempotent thereafter).
   */
  public attachTransport(transport: Transport<LogObj> | TransportFn<LogObj>): () => void {
    return attachTransport(this.settings.attachedTransports, transport);
  }

  /**
   * Await every attached transport's `flush()` — and the runtime's default JSON sink (the Node entry
   * batches stdout writes) — so buffered output is written before the process exits. Transports
   * without a `flush` are skipped; a failing flush is isolated and never rejects this promise.
   */
  public async flush(): Promise<void> {
    await Promise.all([flushAll(this.settings.attachedTransports), this._flushDefaultSink()]);
  }

  /** Flush the runtime's default JSON sink, isolating any failure (mirrors `flushAll`'s contract). */
  private async _flushDefaultSink(): Promise<void> {
    try {
      await this.runtime.flushJsonSink?.();
    } catch {
      // a failing sink flush must never reject flush()/dispose
    }
  }

  /** The transports this logger owns (constructor-supplied or attached here; not inherited from a parent). */
  private _ownedTransports(): Transport<LogObj>[] {
    const inherited = this.inheritedTransports;
    if (inherited == null) {
      return this.settings.attachedTransports;
    }
    return this.settings.attachedTransports.filter((transport) => !inherited.has(transport as object));
  }

  /**
   * Async disposer (`await using`): flushes every attached transport, then disposes the ones this logger
   * OWNS. Transports inherited from a parent are flushed but left alive — disposing a request-scoped
   * child must not terminate the root logger's sinks.
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    await Promise.all([flushAll(this.settings.attachedTransports), this._flushDefaultSink()]);
    await disposeAll(this._ownedTransports());
  }

  /**
   * Sync disposer (`using`) — best-effort (E1). Triggers each attached transport's flush+dispose but, being
   * synchronous, cannot await them: a transport whose `flush`/`[Symbol.asyncDispose]` is async is kicked off
   * and left to settle on its own (the rejection is isolated and swallowed by `flushAll`). For guaranteed
   * draining of buffered/async transports prefer `await using` (the {@link Symbol.asyncDispose} path) or an
   * explicit `await logger.flush()`. Provided so a logger also works under synchronous `using` scopes.
   */
  public [Symbol.dispose](): void {
    // Fire-and-forget (a sync disposer cannot await), but SEQUENCED: disposing a transport while its
    // in-flight writes are still being flushed would tear the sink down under them. Only owned
    // transports are disposed (see above).
    void this._flushDefaultSink();
    void flushAll(this.settings.attachedTransports).then(() => disposeAll(this._ownedTransports()));
  }

  /**
   *  Returns a child logger based on the current instance with inherited settings
   *
   * @param settings - Overwrite settings inherited from parent logger
   * @param logObj - Overwrite logObj for sub-logger
   */
  /**
   * Alias for {@link getSubLogger} (E2) — matches the pino/bunyan/winston `child(...)` convention that
   * AI models and many ecosystems reach for by reflex. Same inheritance semantics (settings/levels/context
   * are inherited and merged); both methods are kept.
   *
   * @param settings - Overwrite settings inherited from parent logger
   * @param logObj - Overwrite logObj for sub-logger
   */
  public child(settings?: ISettingsParam<LogObj>, logObj?: LogObj): BaseLogger<LogObj> {
    return this.getSubLogger(settings, logObj);
  }

  public getSubLogger(settings?: ISettingsParam<LogObj>, logObj?: LogObj): BaseLogger<LogObj> {
    // Pass the merged settings to the constructor, which re-runs normalizeSettings so the grouped
    // fields (mask/json/attachedTransports/middleware) are re-resolved from the parent's resolved values
    // plus any sub-logger overrides. We hand a partial param shape; the constructor fully populates it.
    // Merge additive custom levels (M2.14) so a sub-logger inherits the parent's and may extend them; used
    // below to resolve a string `minLevel` that names a custom level.
    const mergedCustomLevels: Record<string, number> = { ...this.settings.customLevels, ...settings?.customLevels };

    const subLoggerSettings: ISettingsParam<LogObj> = {
      ...this.settings,
      ...settings,
      // resolve a level-name minLevel (e.g. "WARN" or a custom "NOTICE") back to its numeric id
      minLevel: resolveLogLevelId(settings?.minLevel, mergedCustomLevels) ?? this.settings.minLevel,
      customLevels: mergedCustomLevels,
      // Deep-merge each grouped object so a sub-logger overriding ONE field of a group keeps the parent's
      // other resolved defaults for that group (per-group shallow merge over the parent's resolved values).
      pretty: { ...this.settings.pretty, ...settings?.pretty },
      json: { ...this.settings.json, ...settings?.json },
      mask: { ...this.settings.mask, ...settings?.mask },
      stack: { ...this.settings.stack, ...settings?.stack },
      meta: { ...this.settings.meta, ...settings?.meta },
      attachedTransports: [...this.settings.attachedTransports, ...(settings?.attachedTransports ?? [])],
      middleware: [...this.settings.middleware, ...(settings?.middleware ?? [])],
      // collect parent names in Array
      parentNames:
        this.settings?.parentNames != null && this.settings?.name != null
          ? [...this.settings.parentNames, this.settings.name]
          : this.settings?.name != null
            ? [this.settings.name]
            : undefined,
      // merge all prefixes instead of overwriting them
      prefix: [...this.settings.prefix, ...(settings?.prefix ?? [])],
      // bindings merge down the chain: the child's extend (and win over) the parent's. Merge from the
      // RAW (pre-mask) values — the child constructor masks the merged object exactly once, so
      // non-idempotent censors ("hash", functions) never re-process already-masked values.
      bindings: this.rawBindings != null || settings?.bindings != null ? { ...this.rawBindings, ...settings?.bindings } : undefined,
      // A nullish child value inherits the parent's injected instance (passing `null` must not silently
      // swap the family onto an auto-resolved store while still sharing the parent's box below).
      contextStorage: settings?.contextStorage ?? this.settings.contextStorage,
    };

    const subLogger: BaseLogger<LogObj> = new (
      this.constructor as new (
        subLoggerSettings: ISettingsParam<LogObj> | undefined,
        logObj: LogObj | undefined,
        environment: EnvironmentProvider,
        callerFrame?: number,
        features?: CoreFeatures,
      ) => this
    )(subLoggerSettings, logObj ?? this.logObj, this.runtime, this.callerFrame, this.features);
    // Share the async context BOX (M2.13) with the child so a context entered anywhere in the family —
    // even via a member created later — propagates to every member's calls. A child that injects its OWN
    // `contextStorage` opts out of the family store and keeps its fresh box instead.
    if (settings?.contextStorage == null || settings.contextStorage === this.settings.contextStorage) {
      subLogger.asyncContextBox = this.asyncContextBox;
    }
    // Everything the child received from this logger's list is inherited (including what THIS logger
    // itself inherited): the child's disposers flush them but never dispose them.
    subLogger.inheritedTransports = new WeakSet(this.settings.attachedTransports as unknown as object[]);
    return subLogger;
  }

  private _resolveLogArguments(args: unknown[]): unknown[] {
    if (args.length === 1 && typeof args[0] === "function") {
      const candidate = args[0] as () => unknown;
      if (candidate.length === 0) {
        const result = candidate();
        // Copy a returned array: it is CALLER-owned (often reused across calls), and downstream
        // consumers (middleware ctx.args, the empty-prefix zero-copy path) may append to the array
        // they receive — the per-call rest array is private, a lazy-returned array is not.
        return Array.isArray(result) ? [...result] : [result];
      }
    }
    return args;
  }

  private _addMetaToLogObj(logObj: LogObj, logLevelId: number, logLevelName: string): LogObj & ILogObjMeta & ILogObj {
    const meta = this.runtime.getMeta(
      logLevelId,
      logLevelName,
      this.callerFrame,
      !this.captureStackForMeta,
      this.settings.name,
      this.settings.parentNames,
      this.settings.stack.internalFramePatterns,
    );
    // Injectable clock (the time seam): replaces the provider's `new Date()` on the record. Guarded —
    // a throwing clock or a non-Date/invalid result keeps the runtime date, never breaks the log call.
    const clock = this.settings.clock;
    if (clock != null) {
      try {
        const stamped = clock();
        if (stamped instanceof Date && !Number.isNaN(stamped.getTime())) {
          meta.date = stamped;
        }
      } catch {
        // keep the provider's date
      }
    }
    // NOTE: the spread also carries the enumerable symbol-keyed SPREAD_SHAPE_HINT forward.
    return {
      ...logObj,
      [this.settings.meta.property]: meta,
    };
  }

  private _shouldCaptureStack(): boolean {
    const capture = this.settings.stack.capture;
    if (capture === "off") {
      return false;
    }
    if (capture === "full" || capture === "lazy") {
      return true;
    }
    // "auto": for json the TYPE-DRIVEN default already resolved to "off", but an EXPLICIT
    // `stack.capture: "auto"` still reaches here (set directly, or inherited by a sub-logger whose
    // parent resolved "auto" and which switches to type: "json"); json has no template to consult,
    // so auto means capture. For pretty/hidden, capture only when the template references a
    // code-position placeholder so the cost is paid solely when it is actually rendered.
    if (this.settings.type === "json") {
      return true;
    }

    const template = this.settings.pretty.template ?? "";
    const stackPlaceholders = /{{\s*(file(Name|Path|Line|PathWithLine|NameWithLine)|fullFilePath)\s*}}/;
    return stackPlaceholders.test(template);
  }
}
