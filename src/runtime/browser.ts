const meta = {
    runtime: "Browser",
    // @ts-ignore
    browser: window.navigator.userAgent
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
    }
}

export function prettyFormatLogObj(maskedArgs: unknown[], prettyInspectOptions: unknown) {
    return maskedArgs;
}
