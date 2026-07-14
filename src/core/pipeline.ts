import type { EnvironmentProvider } from "../env/environment.js";
import type { FormatStage, ILogObjMeta, IMeta, ISettings, LogContext, LogFormatter, LogMiddleware, TLogFormat } from "../interfaces.js";
import { renderJson } from "../render/json.js";

/**
 * `core/pipeline.ts` — the single formatting + middleware path (M2.6).
 *
 * v4 carried eight `overwrite.*` hooks and an arity-sniffing `transportFormatted`, branching through a
 * tangle of if/else in `BaseLogger.log()`. v5 deletes all of that. The replacement is two small,
 * composable pieces that live here:
 *
 *  1. **Middleware** — `logger.use(mw)` appends a {@link LogMiddleware}. {@link runMiddleware} runs the
 *     chain in order; any middleware may enrich/rewrite the {@link LogContext} or drop the log (return
 *     `null`/`false`). Returning nothing keeps the passed-in context.
 *  2. **Format stages** — tree-shakeable factories ({@link timestamp}, {@link errors}, {@link json},
 *     {@link pretty}) that each turn a finished, meta-decorated record into the string a transport
 *     writes. The default console output is expressed as a built-in pipeline ({@link defaultFormatter})
 *     so the core has ONE formatting path, not the old overwrite branches.
 *
 * This module performs NO top-level work and imports NO environment at module scope (preserving
 * `sideEffects: false`). The pretty stage needs the runtime's inspect/styling, so it is a factory that
 * receives the {@link EnvironmentProvider} as an argument; the JSON stage is environment-agnostic and
 * delegates to {@link renderJson} in `render/json.ts`.
 *
 * Because a {@link FormatStage} only receives `(record, settings)`, the pretty stage needs the original
 * masked argument array (tslog inspects the ARGS for pretty output, not the reshaped record). The core
 * attaches that array to the record under the non-enumerable {@link PIPELINE_MASKED_ARGS} symbol before
 * formatting, and the pretty stage reads it back via {@link getMaskedArgs}. The symbol is non-enumerable
 * so it never leaks into JSON output or object spreads.
 */

/**
 * Non-enumerable symbol under which the core stashes the masked argument array on the record so the
 * {@link pretty} stage can recover it. Set it via {@link attachMaskedArgs}; read it via
 * {@link getMaskedArgs}. Never enumerable, so JSON serialization and spreads never observe it.
 */
export const PIPELINE_MASKED_ARGS: unique symbol = Symbol("tslog.pipeline.maskedArgs");

/**
 * Attach the masked argument array to `record` (non-enumerably) so a later {@link pretty} stage can read
 * it back with {@link getMaskedArgs}. Returns the same record for convenient chaining.
 *
 * @example
 * const record = attachMaskedArgs(logObjWithMeta, maskedArgs);
 * const line = pretty(provider)(record, settings);
 */
export function attachMaskedArgs<LogObj>(record: LogObj & ILogObjMeta, maskedArgs: unknown[]): LogObj & ILogObjMeta {
  Object.defineProperty(record, PIPELINE_MASKED_ARGS, {
    value: maskedArgs,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return record;
}

/**
 * Read the masked argument array previously attached by {@link attachMaskedArgs}. Falls back to the
 * record's own enumerable values when no array was attached (e.g. a transport formats a record it built
 * itself), so the pretty stage never throws on a hand-rolled record.
 */
export function getMaskedArgs<LogObj>(record: LogObj & ILogObjMeta, metaProperty: string): unknown[] {
  const attached = (record as unknown as Record<symbol, unknown>)[PIPELINE_MASKED_ARGS];
  if (Array.isArray(attached)) {
    return attached;
  }
  // No attached args: best-effort reconstruction from the record's own (non-meta) fields.
  const source = record as unknown as Record<string, unknown>;
  return Object.keys(source)
    .filter((key) => key !== metaProperty)
    .map((key) => source[key]);
}

/**
 * Run the middleware chain over `context` in registration order.
 *
 * Each middleware receives the {@link LogContext} produced by the previous one. A middleware drops the
 * log by returning `null`/`false` — {@link runMiddleware} then returns `null` and the caller must skip
 * formatting and all transports. Returning the context (or nothing) continues the chain.
 *
 * @param context - the initial context (built by the core for this `log()` call).
 * @param middleware - the resolved middleware chain (`settings.middleware`).
 * @returns the final context, or `null` when any middleware dropped the log.
 *
 * @example
 * const ctx = runMiddleware(initialContext, settings.middleware);
 * if (ctx == null) return; // dropped
 */
export function runMiddleware<LogObj>(context: LogContext<LogObj>, middleware: LogMiddleware<LogObj>[]): LogContext<LogObj> | null {
  let current = context;
  for (const mw of middleware) {
    const result = mw(current);
    if (result === null || result === false) {
      return null;
    }
    if (result !== undefined) {
      current = result;
    }
  }
  return current;
}

/**
 * Format stage that renders the record as the flat, fields-first JSON line (M2.1/M2.2). Environment-
 * agnostic — delegates to {@link renderJson} in `render/json.ts`.
 *
 * @example
 * const line = json<MyLog>()(record, settings);
 */
export function json<LogObj>(): FormatStage<LogObj> {
  return (record, settings) => renderJson(record, settings);
}

/**
 * Format stage that renders the record as a pretty, human-readable line, delegating to the injected
 * {@link EnvironmentProvider}'s pretty-format path (`prettyFormatLine`). The provider owns inspect,
 * meta markup, error rendering, and ANSI handling, so all runtimes share one implementation.
 *
 * This stage produces the plain-text pretty line used by attached transports and per-transport
 * `format: "pretty"`. The live console (which may add browser CSS `%c` styling) is still driven by the
 * provider's `transportFormatted` from the core.
 *
 * @param provider - the runtime environment provider (Node, browser, or universal).
 * @example
 * const line = pretty<MyLog>(this.runtime)(record, settings);
 */
export function pretty<LogObj>(provider: EnvironmentProvider): FormatStage<LogObj> {
  return (record, settings) => {
    const meta = record[settings.meta.property] as unknown as IMeta | undefined;
    const maskedArgs = getMaskedArgs(record, settings.meta.property);
    return provider.prettyFormatLine(maskedArgs, meta, settings);
  };
}

/**
 * Format stage that prefixes the output of an inner pretty/json stage with the record's ISO timestamp.
 *
 * Provided as a tree-shakeable building block for callers assembling a custom pipeline. It is NOT part
 * of the built-in default formatter (the pretty and JSON renderers already place the timestamp where
 * each format wants it); compose it explicitly when you want a leading timestamp on a custom line.
 *
 * @param inner - the stage whose output is prefixed.
 * @example
 * const stage = timestamp<MyLog>(json());
 * stage(record, settings); // "2026-06-29T10:11:12.000Z {\"level\":\"INFO\",…}"
 */
export function timestamp<LogObj>(inner: FormatStage<LogObj>): FormatStage<LogObj> {
  return (record, settings) => {
    const meta = record[settings.meta.property] as unknown as IMeta | undefined;
    const iso = meta?.date instanceof Date ? meta.date.toISOString() : "";
    const body = inner(record, settings);
    return iso.length > 0 ? `${iso} ${body}` : body;
  };
}

/**
 * Format stage that appends any logged errors (rendered through the provider's pretty error template)
 * after an inner stage's output.
 *
 * Like {@link timestamp}, this is a composable building block, not part of the default formatter (the
 * pretty renderer already inlines errors and the JSON renderer nests them under `errorKey`). Use it when
 * building a custom textual pipeline that should tack a rendered error block onto another stage's line.
 *
 * @param inner - the stage whose output the rendered errors follow.
 * @param provider - the runtime provider supplying `prettyFormatErrorObj`.
 * @example
 * const stage = errors<MyLog>((r) => "context", this.runtime);
 */
export function errors<LogObj>(inner: FormatStage<LogObj>, provider: EnvironmentProvider): FormatStage<LogObj> {
  return (record, settings) => {
    const body = inner(record, settings);
    const maskedArgs = getMaskedArgs(record, settings.meta.property);
    const rendered = maskedArgs.filter((arg) => provider.isError(arg)).map((arg) => provider.prettyFormatErrorObj(arg as Error, settings));
    if (rendered.length === 0) {
      return body;
    }
    const errorBlock = rendered.join("\n");
    return body.length > 0 ? `${body}\n${errorBlock}` : errorBlock;
  };
}

/**
 * Resolve a {@link TLogFormat} (`"pretty"`, `"json"`, or a custom {@link LogFormatter}) to a concrete
 * {@link LogFormatter}. This is how the core turns the logger-wide `type` and each transport's `format`
 * into a single function that produces the line for that sink — the one place the old `type`/overwrite
 * branching is replaced.
 *
 * `"pretty"` resolves to the {@link pretty} stage (bound to `provider`), `"json"` to the {@link json}
 * stage, and a function is returned as-is.
 *
 * @param format - the format selector.
 * @param provider - the runtime provider, needed to build the pretty formatter.
 * @returns a {@link LogFormatter} that turns a record + settings into the output line.
 *
 * @example
 * const fmt = resolveFormatter(transport.format ?? settings.type, this.runtime, this.features.renderJson);
 * transport.write(record, fmt(record, settings));
 */
export function resolveFormatter<LogObj>(format: TLogFormat<LogObj>, provider: EnvironmentProvider, jsonLine: LogFormatter<LogObj>): LogFormatter<LogObj> {
  if (format === "json") {
    // The JSON renderer is INJECTED (the entry's feature set supplies it) rather than resolved here:
    // referencing the json() stage from this body would keep the precompiled line-plan renderer alive
    // in every bundle, defeating the size-sensitive entries that inject the plan-free path.
    return jsonLine;
  }
  if (format === "pretty") {
    return pretty<LogObj>(provider);
  }
  return format;
}

/**
 * The default console formatter: the built-in pipeline that expresses the logger-wide `type`. `"json"`
 * uses the JSON stage, everything else (`"pretty"`, `"hidden"`) uses the pretty stage. The core selects
 * this for the console transport so there is a single formatting path; `"hidden"` is handled by the core
 * skipping the console write, not by a separate formatter.
 *
 * @param settings - the resolved settings (its `type` selects the stage).
 * @param provider - the runtime provider (needed for the pretty stage).
 * @example
 * const line = defaultFormatter(this.settings, this.runtime, this.features.renderJson)(record, this.settings);
 */
export function defaultFormatter<LogObj>(settings: ISettings<LogObj>, provider: EnvironmentProvider, jsonLine: LogFormatter<LogObj>): LogFormatter<LogObj> {
  return resolveFormatter(settings.type === "json" ? "json" : "pretty", provider, jsonLine);
}
