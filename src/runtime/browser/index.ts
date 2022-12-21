import { ILogObjMeta, ISettings, IStackFrame } from "../../interfaces.js";
import { formatTemplate } from "../../formatTemplate.js";
import { formatWithOptions } from "./util.inspect.polyfil.js";
import { jsonStringifyRecursive } from "./helper.jsonStringifyRecursive.js";

export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: string;
  browser: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path: IStackFrame;
}

const meta: IMetaStatic = {
  runtime: "Browser",
  browser: window?.["navigator"].userAgent,
};

export function getMeta(logLevelId: number, logLevelName: string, stackDepthLevel: number, name?: string): IMeta {
  return {
    ...meta,
    name,
    date: new Date(),
    logLevelId,
    logLevelName,
    path: getCallerStackFrame(stackDepthLevel),
  };
}

export function getCallerStackFrame(stackDepthLevel: number): IStackFrame {
  try {
    throw new Error("getStackTrace");
  } catch (e: unknown) {
    const href = window.location.origin;

    const error = e as Error | undefined;
    if (error?.stack) {
      let fullFilePath: string | undefined = error?.stack
        ?.split("\n")
        ?.filter((line: string) => !line.includes("Error: "))
        ?.[stackDepthLevel]?.replace(/^\s+at\s+/gm, "");
      if (fullFilePath?.slice(-1) === ")") {
        fullFilePath = fullFilePath?.match(/\(([^)]+)\)/)?.[1];
      }

      const pathArray = fullFilePath?.includes(":")
        ? fullFilePath
            ?.replace("global code@", "")
            ?.replace("file://", "")
            ?.replace(href, "")
            ?.replace(/^\s+at\s+/gm, "")
            ?.split(":")
        : undefined;

      // order plays a role, runs from the back: column, line, path
      const fileColumn = pathArray?.pop();
      const fileLine = pathArray?.pop();
      const filePath = pathArray?.pop()?.split("?")?.[0];
      const fileName = filePath?.split("/").pop();
      const fileNameWithLine = `${fileName}:${fileLine}`;
      const filePathWithLine = `${filePath}:${fileLine}`;
      const errorStackLine = fullFilePath?.split(" (");
      return {
        fullFilePath,
        fileName,
        fileNameWithLine,
        fileColumn,
        fileLine,
        filePath,
        filePathWithLine,
        method: errorStackLine?.[0],
      };
    }

    return {
      fullFilePath: undefined,
      fileName: undefined,
      fileNameWithLine: undefined,
      fileColumn: undefined,
      fileLine: undefined,
      filePath: undefined,
      filePathWithLine: undefined,
      method: undefined,
    };
  }
}

export function getErrorTrace(error: Error): IStackFrame[] {
  const href = window.location.origin;
  return (error as Error)?.stack
    ?.split("\n")
    ?.filter((line: string) => !line.includes("Error: "))
    ?.reduce((result: IStackFrame[], line: string) => {
      if (line?.slice(-1) === ")") {
        line = line.match(/\(([^)]+)\)/)?.[1] ?? "";
      }
      line = line.replace(/^\s+at\s+/gm, "");
      const errorStackLine = line.split(" (");
      const fullFilePath = line?.slice(-1) === ")" ? line?.match(/\(([^)]+)\)/)?.[1] : line;
      const pathArray = fullFilePath?.includes(":")
        ? fullFilePath
            ?.replace("global code@", "")
            ?.replace("file://", "")
            ?.replace(href, "")
            ?.replace(/^\s+at\s+/gm, "")
            ?.split(":")
        : undefined;

      // order plays a role, runs from the back: column, line, path
      const fileColumn = pathArray?.pop();
      const fileLine = pathArray?.pop();
      const filePath = pathArray?.pop()?.split("?")[0];
      const fileName = filePath?.split("/")?.pop()?.split("?")[0];
      const fileNameWithLine = `${fileName}:${fileLine}`;
      const filePathWithLine = `${filePath}:${fileLine}`;

      if (filePath != null && filePath.length > 0) {
        result.push({
          fullFilePath,
          fileName,
          fileNameWithLine,
          fileColumn,
          fileLine,
          filePath,
          filePathWithLine,
          method: errorStackLine?.[1] != null ? errorStackLine?.[0] : undefined,
        });
      }

      return result;
    }, []) as IStackFrame[];
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
}

export function isBuffer(arg: unknown) {
  return undefined;
}
