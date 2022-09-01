const meta = {
    runtime: "Browser",
    // @ts-ignore
    browser: window.navigator.userAgent
};

export function getMeta(logLevelId: number, logLevelName: string) {
    return {
        ...meta,
        date: new Date(),
        logLevelId,
        logLevelName,
        path: trace()
    };
}

function trace() {
    try {
        throw new Error('getStackTrace');
    }
    catch (e: any) {
        // @ts-ignore
        const href = window.location.origin;

        let fullFilePath = e.stack.split("\n").filter((line: string) => !line.includes("internal/")).pop()
            .replace(/^\s+at\s+/gm, ''); // remove prefix text ' at '
        if(fullFilePath.slice(-1) === ")") {
            fullFilePath = fullFilePath.match(/\(([^)]+)\)/)[1];
        }

        const pathArray = fullFilePath?.replace("file://", "")?.replace(href, "")?.split(":");
        return {
            fullFilePath,
            filePath: pathArray[0],
            fileLine: pathArray[1],
            fileColumn: pathArray[2]
        };
    }
}

export function prettyFormatLogObj(maskedArgs: unknown[], prettyInspectOptions: unknown) {
    return maskedArgs;
}
