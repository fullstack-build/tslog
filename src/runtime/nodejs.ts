import { hostname } from "os";
import { formatWithOptions, InspectOptions, inspect } from "util";
export { InspectOptions };

const meta = {
  runtime: "Nodejs",
  hostname: hostname()
};

export function getMeta(logLevelId: number, logLevelName: string, stackDepthLevel: number) {
    return {
        ...meta,
        date: new Date(),
        logLevelId,
        logLevelName,
        path: getTrace(stackDepthLevel)
    };
}

export function getTrace(stackDepthLevel: number) {
    try {
        throw new Error('getStackTrace');
    }
    catch (e: any) {

        let fullFilePath = e.stack.split("\n").filter((line: string) => line.includes("    at "))?.[stackDepthLevel]?.replace(/^\s+at\s+/gm, ''); // remove prefix text ' at '
        if(fullFilePath?.slice(-1) === ")") {
            fullFilePath = fullFilePath.match(/\(([^)]+)\)/)[1];
        }

        const pathArray = fullFilePath?.replace("file://", "")?.replace(process.cwd(), "")?.split(":");
        return {
            fullFilePath,
            filePath: pathArray?.[0],
            fileLine: pathArray?.[1]
        };
    }
}

export function prettyFormatLogObj(maskedArgs: unknown[], prettyInspectOptions: InspectOptions) {
    return formatWithOptions(prettyInspectOptions, ...maskedArgs);
}

export function transport(logMetaMarkup: string, logMarkup: string): void {
    console.log(logMetaMarkup + logMarkup);
}

export function transportJSON(json: any): void {
    console.log(JSON.stringify(json, null, 2));
}
