import { ILogObjMeta, ISettings, IStackFrame, IRuntime } from "../../interfaces.js";
import { formatTemplate } from "../../formatTemplate.js";
import { formatWithOptions, InspectOptions } from "./util.inspect.polyfil.js";
import { jsonStringifyRecursive } from "./helper.jsonStringifyRecursive.js";

export { InspectOptions };

export default {
  getCallerStackFrame,
  getErrorTrace,
  getMeta,
  transportJSON,
  transportFormatted,
  isBuffer,
  isError,
  prettyFormatLogObj,
  prettyFormatErrorObj,
} as IRuntime;

export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: "Nodejs" | "Browser" | "Generic";
  browser: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path?: IStackFrame;
}

const meta: IMetaStatic = {
  runtime: ![typeof window, typeof document].includes("undefined") ? "Browser" : "Generic",
  browser: globalThis?.["navigator"]?.userAgent,
};

const pathRegex = /(?:(?:file|https?|global code|[^@]+)@)?(?:file:)?((?:\/[^:/]+){2,})(?::(\d+))?(?::(\d+))?/;

export function getMeta(
  logLevelId: number,
  logLevelName: string,
  stackDepthLevel: number,
  hideLogPositionForPerformance: boolean,
  name?: string,
  parentNames?: string[]
): IMeta {
  // faster than spread operator
  return Object.assign({}, meta, {
    name,
    parentNames,
    date: new Date(),
    logLevelId,
    logLevelName,
    path: !hideLogPositionForPerformance ? getCallerStackFrame(stackDepthLevel) : undefined,
  }) as IMeta;
}

export function getCallerStackFrame(stackDepthLevel: number, error: Error = Error()): IStackFrame {
  return stackLineToStackFrame((error as Error | undefined)?.stack?.split("\n")?.filter((line: string) => !line.includes("Error: "))?.[stackDepthLevel]);
}

export function getErrorTrace(error: Error): IStackFrame[] {
  return ((error as Error)?.stack?.split("\n") ?? [])
    ?.filter((line: string) => !line.includes("Error: "))
    ?.reduce((result: IStackFrame[], line: string) => {
      result.push(stackLineToStackFrame(line));

      return result;
    }, []) as IStackFrame[];
}

function stackLineToStackFrame(line?: string): IStackFrame {
  const href = globalThis?.location?.origin;

  const pathResult: IStackFrame = {
    fullFilePath: undefined,
    fileName: undefined,
    fileNameWithLine: undefined,
    fileColumn: undefined,
    fileLine: undefined,
    filePath: undefined,
    filePathWithLine: undefined,
    method: undefined,
  };
  if (line != null) {
    const match = line.match(pathRegex);
    if (match) {
      pathResult.filePath = match[1].replace(/\?.*$/, "");
      pathResult.fullFilePath = `${href}${pathResult.filePath}`;
      const pathParts = pathResult.filePath.split("/");
      pathResult.fileName = pathParts[pathParts.length - 1];
      pathResult.fileLine = match[2];
      pathResult.fileColumn = match[3];
      pathResult.filePathWithLine = `${pathResult.filePath}:${pathResult.fileLine}`;
      pathResult.fileNameWithLine = `${pathResult.fileName}:${pathResult.fileLine}`;
    }
  }

  return pathResult;
}

export function isError(e: Error | unknown): boolean {
  return e instanceof Error;
}

export function prettyFormatLogObj<LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>): { args: unknown[]; errors: string[] } {
  return maskedArgs.reduce(
    (result: { args: unknown[]; errors: string[] }, arg) => {
      isError(arg) ? result.errors.push(prettyFormatErrorObj(arg as Error, settings)) : result.args.push(arg);
      return result;
    },
    { args: [], errors: [] }
  );
}

export function prettyFormatErrorObj<LogObj>(error: Error, settings: ISettings<LogObj>): string {
  const errorStackStr = getErrorTrace(error as Error).map((stackFrame) => {
    return formatTemplate(settings, settings.prettyErrorStackTemplate, { ...stackFrame }, true);
  });

  const placeholderValuesError = {
    errorName: ` ${error.name} `,
    errorMessage: Object.getOwnPropertyNames(error)
      .reduce((result: string[], key) => {
        if (key !== "stack") {
          result.push((error as any)[key]);
        }
        return result;
      }, [])
      .join(", "),
    errorStack: errorStackStr.join("\n"),
  };
  return formatTemplate(settings, settings.prettyErrorTemplate, placeholderValuesError);
}

export function transportFormatted<LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: ISettings<LogObj>): void {
  const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
  settings.prettyInspectOptions.colors = settings.stylePrettyLogs;
  console.log(logMetaMarkup + formatWithOptions(settings.prettyInspectOptions, ...logArgs) + logErrorsStr);
}

export function transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
  console.log(jsonStringifyRecursive(json));
}

export function isBuffer(arg?: unknown) {
  return arg ? false : false;
}
