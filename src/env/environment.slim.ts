import { type AsyncContextStore, createAsyncContextStore } from "../core/asyncContext.js";
import type { ILogObjMeta, IMeta, ISettings, IStackFrame } from "../interfaces.js";
import { safeErrorString } from "../internal/errorUtils.js";
import { jsonStringifyRecursive } from "../internal/jsonStringifyRecursive.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import type { EnvironmentProvider } from "./environment.js";
import { createRuntimeMeta, detectRuntimeInfo, isNativeError, type RuntimeMetaStatic, stringifyFallback } from "./shared.js";

/**
 * The SLIM {@link EnvironmentProvider} — injected by the `tslog/slim` entry, whose whole point is the
 * smallest possible structured-JSON logger. Compared to the full providers it deliberately drops:
 *
 *  - **stack capture and parsing**: `getMeta` never attaches `path`, `getErrorTrace` returns `[]`
 *    (logged Errors keep name/message/cause, with an empty `stack` array);
 *  - **the pretty subsystem**: no inspect, no styling, no meta markup. The entry rejects
 *    `type: "pretty"` at construction; the stubs below only run if a user forces `format: "pretty"`
 *    onto an attached transport, and then produce plain, unstyled text.
 *
 * Runtime detection, hostname resolution, and async-context propagation are KEPT — they are small and
 * carry real observability value.
 */
export function createSlimEnvironment(): EnvironmentProvider {
  const staticMeta: RuntimeMetaStatic = createRuntimeMeta(detectRuntimeInfo());

  const provider: EnvironmentProvider = {
    getMeta(logLevelId: number, logLevelName: string, _callerFrame: number, _hideLogPosition: boolean, name?: string, parentNames?: string[]): IMeta {
      const meta = Object.assign({}, staticMeta, {
        date: new Date(),
        logLevelId,
        logLevelName,
      }) as IMeta;
      if (name !== undefined) {
        meta.name = name;
      }
      if (parentNames !== undefined) {
        meta.parentNames = parentNames;
      }
      return meta;
    },
    getCallerStackFrame(): IStackFrame {
      return {};
    },
    getErrorTrace(): IStackFrame[] {
      return [];
    },
    isError(value: unknown): value is Error {
      return isNativeError(value);
    },
    isBuffer(value: unknown): boolean {
      return typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" ? Buffer.isBuffer(value) : false;
    },
    prettyFormatLogObj<LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>): { args: unknown[]; errors: string[] } {
      const args: unknown[] = [];
      const errors: string[] = [];
      for (const arg of maskedArgs) {
        if (provider.isError(arg)) {
          errors.push(provider.prettyFormatErrorObj(arg as Error, settings));
        } else {
          args.push(arg);
        }
      }
      return { args, errors };
    },
    prettyFormatErrorObj(error: Error): string {
      // Guarded reads: error-likes with hostile getters must not throw out of the log call (the line
      // is computed before the per-transport isolation kicks in).
      const message = safeErrorString(error, "message", "");
      return `${safeErrorString(error, "name", "Error")}${message ? `: ${message}` : ""}`;
    },
    prettyFormatLine<LogObj>(maskedArgs: unknown[], meta: IMeta | undefined, settings: ISettings<LogObj>): string {
      const { args, errors } = provider.prettyFormatLogObj(maskedArgs, settings);
      const body = [...args.map(stringifyFallback), ...errors].join(" ");
      /* v8 ignore next 3 -- defensive: slim rejects type "pretty" at construction; per-transport pretty formatting always passes a meta */
      if (meta == null) {
        return body;
      }
      /* v8 ignore next -- defensive: per-transport pretty formatting always passes a complete meta, so logLevelName is set */
      const level = meta.logLevelName ?? "";
      return `${level}\t${body}`;
    },
    transportFormatted<LogObj>(
      logMetaMarkup: string,
      logArgs: unknown[],
      logErrors: string[],
      _logMeta: IMeta | undefined,
      _settings: ISettings<LogObj>,
    ): void {
      nativeConsoleMethod("log")(logMetaMarkup + [...logArgs.map(stringifyFallback), ...logErrors].join(" "));
    },
    transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
      nativeConsoleMethod("log")(jsonStringifyRecursive(json));
    },
    createAsyncContextStore(): AsyncContextStore {
      return createAsyncContextStore();
    },
  };

  return provider;
}
