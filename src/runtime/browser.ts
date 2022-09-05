import { ILogObjMeta, ITrace } from "../interfaces";

export interface IMetaStatic {
    runtime: string;
    browser: string;
}

export interface IMeta extends IMetaStatic{
    date: Date;
    logLevelId: number;
    logLevelName: string;
    path: ITrace
}

const meta: IMetaStatic = {
    runtime: "Browser",
    // @ts-ignore
    browser: window.navigator.userAgent
};

export function getMeta(logLevelId: number, logLevelName: string, stackDepthLevel: number): IMeta {
    return {
        ...meta,
        date: new Date(),
        logLevelId,
        logLevelName,
        path: getTrace(stackDepthLevel)
    };
}

export function getTrace(stackDepthLevel: number): ITrace {
    try {
        throw new Error('getStackTrace');
    }
    catch (e: any) {
        // @ts-ignore
        const href = window.location.origin;

        if(e.stack) {
            let fullFilePath = e.stack.split("\n").filter((line: string) => !line.includes("Error: "))?.[(stackDepthLevel)];
            if(fullFilePath?.slice(-1) === ")") {
                fullFilePath = fullFilePath.match(/\(([^)]+)\)/)[1];
            }

            const pathArray = fullFilePath?.replace("global code@", "")?.replace("file://", "")?.replace(href, "")?.replace(/^\s+at\s+/gm, '')?.split(":");
            return {
                fullFilePath,
                filePath: pathArray?.[0]?.split("?")?.[0],
                fileLine: pathArray[((pathArray?.length ?? 2) - 2)]
            };
        }

        return {
            fullFilePath: "",
            filePath: "",
            fileLine: ""
        };
    }
}

export function prettyFormatLogObj(maskedArgs: unknown[], prettyInspectOptions: unknown): unknown[] {
    return maskedArgs;
}

export function transportFormatted(logMetaMarkup: string, logMarkup: string): void {

    if(Array.isArray(logMarkup)) {
        const str = logMarkup.shift();
        console.log(logMetaMarkup + str, logMarkup);
    } else {
        console.log(logMetaMarkup + logMarkup);
    }
}

export function transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
    console.log(JSON.stringify(json, null, 2));
}
