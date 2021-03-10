"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerHelper = void 0;
const util_1 = require("util");
const fs_1 = require("fs");
const path_1 = require("path");
const CallSitesHelper_1 = require("./CallSitesHelper");
/** @internal */
class LoggerHelper {
    // eslint-disable-next-line @rushstack/no-new-null
    static cleanUpFilePath(fileName) {
        return fileName == null
            ? fileName
            : Object.entries(fileName.split(path_1.sep))
                .reduce((cleanFileName, fileNamePart) => fileNamePart[1] !== LoggerHelper.cwdArray[fileNamePart[0]]
                ? (cleanFileName += path_1.sep + fileNamePart[1])
                : cleanFileName, "")
                .substring(1);
    }
    static isError(e) {
        // An error could be an instance of Error while not being a native error
        // or could be from a different realm and not be instance of Error but still
        // be a native error.
        return (util_1.types === null || util_1.types === void 0 ? void 0 : util_1.types.isNativeError) != null
            ? util_1.types.isNativeError(e)
            : e instanceof Error;
    }
    static getCallSites(error, cleanUp = true) {
        const stack = error == null ? CallSitesHelper_1.getCallSites(new Error()).slice(1) : CallSitesHelper_1.getCallSites(error);
        return cleanUp === true && (stack === null || stack === void 0 ? void 0 : stack.reduce) != null
            ? stack.reduce((cleanedUpCallsites, callsite) => {
                var _a, _b, _c;
                if ((callsite === null || callsite === void 0 ? void 0 : callsite.getFileName()) != null &&
                    (callsite === null || callsite === void 0 ? void 0 : callsite.getFileName()) !== "" &&
                    ((_a = callsite === null || callsite === void 0 ? void 0 : callsite.getFileName()) === null || _a === void 0 ? void 0 : _a.indexOf("internal/")) !== 0 &&
                    ((_b = callsite === null || callsite === void 0 ? void 0 : callsite.getFileName()) === null || _b === void 0 ? void 0 : _b.indexOf("module.js")) !== 0 &&
                    ((_c = callsite === null || callsite === void 0 ? void 0 : callsite.getFileName()) === null || _c === void 0 ? void 0 : _c.indexOf("bootstrap_node.js")) !== 0) {
                    cleanedUpCallsites.push(callsite);
                }
                return cleanedUpCallsites;
            }, [])
            : stack;
    }
    static toStackFrameObject(stackFrame) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const filePath = stackFrame.getFileName();
        return {
            filePath: (_a = LoggerHelper.cleanUpFilePath(filePath)) !== null && _a !== void 0 ? _a : "",
            fullFilePath: filePath !== null && filePath !== void 0 ? filePath : "",
            fileName: path_1.basename((_b = stackFrame.getFileName()) !== null && _b !== void 0 ? _b : ""),
            lineNumber: (_c = stackFrame.getLineNumber()) !== null && _c !== void 0 ? _c : undefined,
            columnNumber: (_d = stackFrame.getColumnNumber()) !== null && _d !== void 0 ? _d : undefined,
            isConstructor: (_e = stackFrame.isConstructor()) !== null && _e !== void 0 ? _e : undefined,
            functionName: (_f = stackFrame.getFunctionName()) !== null && _f !== void 0 ? _f : undefined,
            typeName: (_g = stackFrame.getTypeName()) !== null && _g !== void 0 ? _g : undefined,
            methodName: (_h = stackFrame.getMethodName()) !== null && _h !== void 0 ? _h : undefined,
        };
    }
    static initErrorToJsonHelper() {
        if (!("toJSON" in Error.prototype))
            /* eslint-disable */
            Object.defineProperty(Error.prototype, "toJSON", {
                /* eslint-enable */
                value: function () {
                    return Object.getOwnPropertyNames(this).reduce((alt, key) => {
                        alt[key] = this[key];
                        return alt;
                    }, {});
                },
                configurable: true,
                writable: true,
            });
    }
    static overwriteConsole($this, handleLog) {
        ["log", "debug", "info", "warn", "trace", "error"].forEach((name) => {
            console[name] = (...args) => {
                const loglevelMapping = {
                    log: "silly",
                    trace: "trace",
                    debug: "debug",
                    info: "info",
                    warn: "warn",
                    error: "error",
                };
                return handleLog.apply($this, [
                    loglevelMapping[name.toLowerCase()],
                    args,
                ]);
            };
        });
    }
    static setUtilsInspectStyles(utilsInspectStyles) {
        Object.entries(utilsInspectStyles).forEach(([symbol, color]) => {
            util_1.inspect.styles[symbol] = color;
        });
    }
    static styleString(styleTypes, str, colorizePrettyLogs = true) {
        return colorizePrettyLogs
            ? Object.values(styleTypes).reduce((resultStr, styleType) => {
                return LoggerHelper._stylizeWithColor(styleType, resultStr);
            }, str)
            : `${str}`;
    }
    static _stylizeWithColor(styleType, str) {
        var _a;
        const color = (_a = util_1.inspect.colors[styleType]) !== null && _a !== void 0 ? _a : [0, 0];
        return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
    }
    /* Async
    import { createReadStream, readFileSync } from "fs";
    import { createInterface, Interface } from "readline";
    public static async _getCodeFrameAsync(
      filePath: string,
      lineNumber: number | null,
      columnNumber: number | null,
      linesBeforeAndAfter: number
    ): Promise<ICodeFrame | undefined> {
      try {
        const fileStream: NodeJS.ReadableStream = createReadStream(filePath, {
          encoding: "utf-8",
        });
        const rl: Interface = createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });
  
        if (lineNumber != null) {
          const linesBefore: string[] = [];
          let relevantLine: string | undefined;
          const linesAfter: string[] = [];
          let i: number = 0;
          rl.on("line", (line) => {
            if (i < lineNumber && i >= lineNumber - linesBeforeAndAfter) {
              linesBefore.push(line);
            } else if (i === lineNumber) {
              relevantLine = line;
            } else if (i > lineNumber && i <= lineNumber + linesBeforeAndAfter) {
              linesAfter.push(line);
            }
            i++;
          });
          rl.on("close", () => {
            const firstLineNumber: number =
              lineNumber - linesBeforeAndAfter < 0
                ? 0
                : lineNumber - linesBeforeAndAfter;
            return {
              firstLineNumber,
              lineNumber,
              columnNumber,
              linesBefore,
              relevantLine,
              linesAfter,
            };
          });
        }
      } catch {
        return undefined;
      }
    }
    */
    static _getCodeFrame(filePath, lineNumber, columnNumber, linesBeforeAndAfter) {
        var _a;
        const lineNumberMinusOne = lineNumber - 1;
        try {
            const file = (_a = fs_1.readFileSync(filePath, {
                encoding: "utf-8",
            })) === null || _a === void 0 ? void 0 : _a.split("\n");
            const startAt = lineNumberMinusOne - linesBeforeAndAfter < 0
                ? 0
                : lineNumberMinusOne - linesBeforeAndAfter;
            const endAt = lineNumberMinusOne + linesBeforeAndAfter > file.length
                ? file.length
                : lineNumberMinusOne + linesBeforeAndAfter;
            const codeFrame = {
                firstLineNumber: startAt + 1,
                lineNumber,
                columnNumber,
                linesBefore: [],
                relevantLine: "",
                linesAfter: [],
            };
            for (let i = startAt; i < lineNumberMinusOne; i++) {
                if (file[i] != null) {
                    codeFrame.linesBefore.push(file[i]);
                }
            }
            codeFrame.relevantLine = file[lineNumberMinusOne];
            for (let i = lineNumberMinusOne + 1; i <= endAt; i++) {
                if (file[i] != null) {
                    codeFrame.linesAfter.push(file[i]);
                }
            }
            return codeFrame;
        }
        catch (err) {
            // (err) is needed for Node v8 support, remove later
            // fail silently
        }
    }
    static lineNumberTo3Char(lineNumber) {
        return lineNumber < 10
            ? `00${lineNumber}`
            : lineNumber < 100
                ? `0${lineNumber}`
                : `${lineNumber}`;
    }
    static cloneObjectRecursively(obj, maskValuesFn, done = [], clonedObject = Object.create(Object.getPrototypeOf(obj))) {
        done.push(obj);
        // clone array. could potentially be a separate function
        if (obj instanceof Date) {
            return new Date(obj);
        }
        else if (Array.isArray(obj)) {
            return Object.entries(obj).map(([key, value]) => {
                if (value == null || typeof value !== "object") {
                    return value;
                }
                else {
                    return LoggerHelper.cloneObjectRecursively(value, maskValuesFn, done);
                }
            });
        }
        else if (Buffer.isBuffer(obj)) {
            return obj;
        }
        else {
            Object.getOwnPropertyNames(obj).forEach((currentKey) => {
                if (!done.includes(obj[currentKey])) {
                    if (obj[currentKey] == null) {
                        clonedObject[currentKey] = obj[currentKey];
                    }
                    else if (typeof obj[currentKey] !== "object") {
                        clonedObject[currentKey] =
                            maskValuesFn != null
                                ? maskValuesFn(currentKey, obj[currentKey])
                                : obj[currentKey];
                    }
                    else {
                        clonedObject[currentKey] = LoggerHelper.cloneObjectRecursively(obj[currentKey], maskValuesFn, done, clonedObject[currentKey]);
                    }
                }
                else {
                    // cicrular detected: point to itself to make inspect printout [circular]
                    clonedObject[currentKey] = clonedObject;
                }
            });
        }
        return clonedObject;
    }
    static logObjectMaskValuesOfKeys(obj, keys, maskPlaceholder) {
        if (!Array.isArray(keys) || keys.length === 0) {
            return obj;
        }
        const maskValuesFn = (key, value) => {
            const keysLowerCase = keys.map((key) => typeof key === "string" ? key.toLowerCase() : key);
            if (keysLowerCase.includes(typeof key === "string" ? key.toLowerCase() : key)) {
                return maskPlaceholder;
            }
            return value;
        };
        return obj != null
            ? LoggerHelper.cloneObjectRecursively(obj, maskValuesFn)
            : obj;
    }
}
exports.LoggerHelper = LoggerHelper;
LoggerHelper.cwdArray = process.cwd().split(path_1.sep);
//# sourceMappingURL=LoggerHelper.js.map