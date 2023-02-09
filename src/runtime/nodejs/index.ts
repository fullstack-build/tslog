import { hostname } from "os";
import { normalize as fileNormalize } from "path";
import { types, formatWithOptions, InspectOptions } from "util";
import { Runtime, ILogObjMeta, ISettings, IStackFrame } from "../../interfaces.js";
import { formatTemplate } from "../../formatTemplate.js";
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
} as Runtime;

export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: string;
  runtimeVersion: string;
  hostname: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path?: IStackFrame;
}

const meta: IMetaStatic = {
  runtime: "Nodejs",
  runtimeVersion: process.version,
  hostname: hostname(),
};

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
  return stackLineToStackFrame((error as Error | undefined)?.stack?.split("\n")?.filter((thisLine: string) => thisLine.includes("    at "))?.[stackDepthLevel]);
}

export function getErrorTrace(error: Error): IStackFrame[] {
  return (error as Error)?.stack?.split("\n")?.reduce((result: IStackFrame[], line: string) => {
    if (line.includes("    at ")) {
      result.push(stackLineToStackFrame(line));
    }
    return result;
  }, []) as IStackFrame[];
}

function stackLineToStackFrame(line?: string): IStackFrame {
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
  if (line != null && line.includes("    at ")) {
    line = line.replace(/^\s+at\s+/gm, "");
    const errorStackLine = line.split(" (");
    const fullFilePath = line?.slice(-1) === ")" ? line?.match(/\(([^)]+)\)/)?.[1] : line;
    const pathArray = fullFilePath?.includes(":") ? fullFilePath?.replace("file://", "")?.replace(process.cwd(), "")?.split(":") : undefined;
    // order plays a role, runs from the back: column, line, path
    const fileColumn = pathArray?.pop();
    const fileLine = pathArray?.pop();
    const filePath = pathArray?.pop();
    const filePathWithLine = fileNormalize(`${filePath}:${fileLine}`);
    const fileName = filePath?.split("/")?.pop();
    const fileNameWithLine = `${fileName}:${fileLine}`;

    if (filePath != null && filePath.length > 0) {
      pathResult.fullFilePath = fullFilePath;
      pathResult.fileName = fileName;
      pathResult.fileNameWithLine = fileNameWithLine;
      pathResult.fileColumn = fileColumn;
      pathResult.fileLine = fileLine;
      pathResult.filePath = filePath;
      pathResult.filePathWithLine = filePathWithLine;
      pathResult.method = errorStackLine?.[1] != null ? errorStackLine?.[0] : undefined;
    }
  }
  return pathResult;
}

export function isError(e: Error | unknown): boolean {
  // An error could be an instance of Error while not being a native error
  // or could be from a different realm and not be instance of Error but still
  // be a native error.
  return types?.isNativeError != null ? types.isNativeError(e) : e instanceof Error;
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
    errorMessage: error.message,
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

  function jsonStringifyRecursive(obj: unknown) {
    const cache = new Set();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (cache.has(value)) {
          // Circular reference found, discard key
          return "[Circular]";
        }
        // Store value in our collection
        cache.add(value);
      }
      return value;
    });
  }
}

export function isBuffer(arg: unknown) {
  return Buffer.isBuffer(arg);
}
