/// <reference types="node" />
import { Logger } from "./index";
import { ICodeFrame, IHighlightStyles, ILogObject, IStackFrame, TLogLevelName, TUtilsInspectColors } from "./interfaces";
/** @internal */
export declare class LoggerHelper {
    static cwdArray: string[];
    static cleanUpFilePath(fileName: string | null): string | null;
    static isError(e: Error | unknown): boolean;
    static getCallSites(error?: Error, cleanUp?: boolean): NodeJS.CallSite[];
    static toStackFrameObject(stackFrame: NodeJS.CallSite): IStackFrame;
    static initErrorToJsonHelper(): void;
    static overwriteConsole($this: Logger, handleLog: (logLevel: TLogLevelName, logArguments: unknown[], exposeStack?: boolean) => void): ILogObject | void;
    static setUtilsInspectStyles(utilsInspectStyles: IHighlightStyles): void;
    static styleString<T, S>(styleTypes: T | TUtilsInspectColors[], str: S | string, colorizePrettyLogs?: boolean): string;
    private static _stylizeWithColor;
    static _getCodeFrame(filePath: string, lineNumber: number, columnNumber: number | undefined, linesBeforeAndAfter: number): ICodeFrame | undefined;
    static lineNumberTo3Char(lineNumber: number): string;
    static cloneObjectRecursively<T>(obj: T, maskValuesFn?: (key: number | string, value: unknown) => unknown, done?: unknown[], clonedObject?: T): T;
    static logObjectMaskValuesOfKeys<T>(obj: T, keys: (number | string)[], maskPlaceholder: string): T;
}
