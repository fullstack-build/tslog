import type { AsyncContextFields, AsyncContextStore } from "./core/asyncContext.js";
import { createAsyncContextStore } from "./core/asyncContext.js";
import { DEFAULT_PERSIST_LEVEL_KEY, readPersistedLevel, writePersistedLevel } from "./core/levelPersistence.js";
import { resolveLogLevelId as resolveLevelId, validateCustomLevel } from "./core/levels.js";
import { type LogObjDeps, recursiveCloneAndExecuteFunctions, toLogObj } from "./core/logObj.js";
import { MaskingEngine } from "./core/masking.js";
import { attachMaskedArgs, resolveFormatter, runMiddleware } from "./core/pipeline.js";
import { normalizeSettings, resolveLogLevelId, validateSettingsParam } from "./core/settings.js";
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
  TLogFormat,
  TLogLevelName,
  Transport,
  TransportFn,
} from "./interfaces.js";
import { buildPrettyMeta } from "./internal/metaFormatting.js";
import { nativeConsoleMethod } from "./internal/nativeConsole.js";
import { renderJson } from "./render/json.js";

export * from "./interfaces.js";

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
 * The constructor takes `(settings?, logObj?, environment, callerFrame=NaN)`. `callerFrame` (M1.14,
 * renamed from `stackDepthLevel`) is the manual stack-frame index; `NaN` means auto-detect.
 */
export class BaseLogger<LogObj> {
  public readonly runtime: EnvironmentProvider;
  public settings: ISettings<LogObj>;
  private readonly maxErrorCauseDepth = 5;
  private readonly captureStackForMeta: boolean;
  private readonly maskingEngine: MaskingEngine<LogObj>;
  private readonly logObjDeps: LogObjDeps;
  // Async context store (M2.13). Created lazily on first `runInContext`/`getContext`/`log` that needs it, so
  // merely constructing a logger never resolves `AsyncLocalStorage`. Shared with sub-loggers (see getSubLogger)
  // so a context entered on a parent propagates to its children.
  private asyncContextStore?: AsyncContextStore;
  // Transports inherited from a parent logger (set by getSubLogger). Disposing THIS logger flushes
  // everything but only disposes transports it owns — a request-scoped `await using child` must not
  // terminate the root logger's file/worker/http sinks.
  private inheritedTransports?: WeakSet<object>;

  constructor(
    settings: ISettingsParam<LogObj> | undefined,
    private logObj: LogObj | undefined,
    environment: EnvironmentProvider,
    private callerFrame: number = Number.NaN,
  ) {
    validateSettingsParam(settings);
    this.runtime = environment;
    // Normalize into the fully-populated settings object. The engine reads this live (never a copy),
    // so post-construction mutations (e.g. tests setting mask.keys/mask.placeholder) take effect.
    this.settings = normalizeSettings(settings);

    this.maskingEngine = new MaskingEngine<LogObj>(this.settings, {
      isError: (value): value is Error => this.runtime.isError(value),
      isBuffer: (value) => this.runtime.isBuffer(value),
    });
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
    const logObj: LogObj = toLogObj(maskedArgs, this.settings.argumentsArrayName, this.logObjDeps, thisLogObj);

    // Attach the runtime _meta block (incl. v: 5 via the JSON renderer) to produce the finished record.
    const record: LogObj & ILogObjMeta = this._addMetaToLogObj(logObj, effectiveLevelId, effectiveLevelName);

    // Any middleware-stashed meta fields are merged onto the record's _meta block so a later format stage
    // (or a transport) can read trace/correlation data the middleware attached.
    const recordMeta = record[this.settings.meta.property] as IMeta | undefined;
    if (recordMeta != null) {
      // Auto-attach the active async context's fields (M2.13) FIRST, so explicit middleware-stashed meta
      // (set this call) takes precedence over inherited context fields on a key collision.
      if (this.settings.meta.attachContext) {
        const activeContext = this.asyncContextStore?.getStore();
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
      const metaMarkup = buildPrettyMeta(this.settings, recordMeta).text;
      this.runtime.transportFormatted(metaMarkup, prettyArgs, prettyErrors, recordMeta, this.settings);
    } else if (this.settings.type === "json") {
      try {
        nativeConsoleMethod("log")(renderJson(record, this.settings));
        /* v8 ignore next 3 -- defensive: guards against a console.log implementation that itself throws */
      } catch {
        // never let the console sink crash logging
      }
    }

    // Attached transports: each gated by its own minLevel and formatted per its own `format` (lazily,
    // shared across transports that request the same format), every transport isolated in try/catch.
    if (this.settings.attachedTransports.length > 0) {
      const defaultFormat: TLogFormat<LogObj> = this.settings.type === "json" ? "json" : "pretty";
      dispatchToTransports(this.settings.attachedTransports, record, effectiveLevelId, defaultFormat, (rec, format) =>
        resolveFormatter<LogObj>(format, this.runtime)(rec, this.settings),
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
    if (this.asyncContextStore == null) {
      // Prefer the runtime provider's resolver (Node resolves via createRequire); fall back to the core
      // global/builtin probe. Either yields a graceful no-op store where AsyncLocalStorage is unavailable.
      this.asyncContextStore = this.runtime.createAsyncContextStore != null ? this.runtime.createAsyncContextStore() : createAsyncContextStore();
    }
    return this.asyncContextStore;
  }

  /**
   * Run `fn` with `ctx` as the active async context (M2.13). For the (possibly async) duration of `fn`, the
   * fields in `ctx` are attached onto every log's `_meta` (unless `meta.attachContext` is `false`) and are
   * readable via {@link getContext} — across `await`, timers, promise chains, and nested `runInContext`
   * calls (nested contexts inherit and shallow-merge over the parent). Returns whatever `fn` returns.
   *
   * On runtimes without `AsyncLocalStorage` (browsers/edge) this gracefully degrades: `fn` still runs, but
   * no context is propagated. Never throws on account of an unavailable store.
   *
   * @example
   * await logger.runInContext({ requestId: req.id }, async () => {
   *   logger.info("handling");           // _meta.requestId === req.id
   *   await doWork();                    // still in context after the await
   * });
   */
  public runInContext<T>(ctx: AsyncContextFields, fn: () => T): T {
    return this._getAsyncContextStore().run(ctx, fn);
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
   * @example logger.addLevel("NOTICE", 3.5).log(3.5, "NOTICE", "heads up");
   */
  public addLevel(name: string, id: number): this {
    validateCustomLevel(name, id);
    this.settings.customLevels[name] = id;
    return this;
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
   * Await every attached transport's `flush()`, so buffered output is written before the process exits.
   * Transports without a `flush` are skipped; a failing flush is isolated and never rejects this promise.
   */
  public async flush(): Promise<void> {
    await flushAll(this.settings.attachedTransports);
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
    await flushAll(this.settings.attachedTransports);
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
    };

    const subLogger: BaseLogger<LogObj> = new (
      this.constructor as new (
        subLoggerSettings: ISettingsParam<LogObj> | undefined,
        logObj: LogObj | undefined,
        environment: EnvironmentProvider,
        callerFrame?: number,
      ) => this
    )(subLoggerSettings, logObj ?? this.logObj, this.runtime, this.callerFrame);
    // Share the async context store (M2.13) with the child so a context entered on the parent (or on any
    // ancestor) propagates to sub-logger calls. Only shared once the parent has actually materialized one.
    if (this.asyncContextStore != null) {
      subLogger.asyncContextStore = this.asyncContextStore;
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
    // NOTE: the spread also carries the enumerable symbol-keyed SPREAD_SHAPE_HINT forward.
    return {
      ...logObj,
      [this.settings.meta.property]: this.runtime.getMeta(
        logLevelId,
        logLevelName,
        this.callerFrame,
        !this.captureStackForMeta,
        this.settings.name,
        this.settings.parentNames,
        this.settings.stack.internalFramePatterns,
      ),
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
    // "auto": for json the type-driven default already resolved to "off" (so we never reach here with
    // json under auto). For pretty/hidden, capture only when the template references a code-position
    // placeholder so the cost is paid solely when it is actually rendered.
    if (this.settings.type === "json") {
      return true;
    }

    const template = this.settings.pretty.template ?? "";
    const stackPlaceholders = /{{\s*(file(Name|Path|Line|PathWithLine|NameWithLine)|fullFilePath)\s*}}/;
    return stackPlaceholders.test(template);
  }
}
