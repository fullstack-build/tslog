import { getMeta, getTrace, prettyFormatLogObj, InspectOptions } from "./runtime/nodejs";
import { prettyLogStyles } from "./prettyLogStyles";

type TStyle = null | string | string[] | {
    [value:string] : null | string | string[]
};

interface ISettings {
    type: "json" | "pretty" | "hidden";
    argumentsArrayName?: string;
    prettyLogTemplate: string;
    stylePrettyLogs: boolean;
    prettyLogStyles: {
        "yyyy"?: TStyle;
        "mm"?: TStyle;
        "dd"?: TStyle;
        "hh"?: TStyle;
        "MM"?: TStyle;
        "ss"?: TStyle;
        "ms"?: TStyle;
        "dateIsoStr"?: TStyle;
        "logLevelName"?: TStyle;
        "filePath"?: TStyle;
        "fileLine"?: TStyle;
    };
    metaProperty: string;
    prettyInspectOptions: InspectOptions;
    maskPlaceholder: string;
    maskValuesOfKeys: string[];
    maskValuesOfKeysCaseInsensitive: boolean;
}

export class BaseLogger<LogObj> {

    private readonly runtime: "browser" | "nodejs" | "unknown";
    private readonly isBrowserBlinkEngine: boolean;
    private readonly getMeta = getMeta;

    private readonly settings: ISettings;


    public constructor(settings?: any, private logObj?: LogObj, private stackDepthLevel: number = 4) {

        const isBrowser = ![typeof window, typeof document].includes('undefined');
        const isNode = Object.prototype.toString.call(typeof process !== 'undefined' ? process : 0) === '[object process]';
        this.runtime = isBrowser ? "browser" : isNode ? "nodejs" : "unknown";
        // @ts-ignore
        this.isBrowserBlinkEngine = (isBrowser) ? ((window.chrome || (window.Intl && Intl.v8BreakIterator)) && 'CSS' in window) != null : false;
        const isSafari = (isBrowser) ? /^((?!chrome|android).)*safari/i.test(navigator.userAgent) : false;
        this.stackDepthLevel = (isSafari) ? 4: this.stackDepthLevel;

        this.settings = {
            type: settings?.type ?? "pretty",
            argumentsArrayName: settings?.argumentsArrayName,
            prettyLogTemplate: settings?.prettyLogTemplate ?? "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{filePath}}]\n",
            stylePrettyLogs: settings?.stylePrettyLogs ?? true,
            prettyLogStyles:  settings?.prettyLogStyles ?? {
                "logLevelName": {
                    "*": ["bold", "black", "bgWhiteBright", "dim"],
                    "SILLY": ["bold", "white"],
                    "TRACE": ["bold", "whiteBright"],
                    "DEBUG": ["bold", "green"],
                    "INFO": ["bold", "blue"],
                    "WARN": ["bold", "yellow"],
                    "ERROR": ["bold", "red"],
                    "FATAL": ["bold", "redBright"]
                },
                "dateIsoStr": "white",
                "filePath": "white"
            },
            metaProperty: settings?.metaProperty ?? "_meta",
            prettyInspectOptions: settings?.prettyInspectOptions ?? {
                colors: true,
                compact: false,
                depth: Infinity
            },
            maskPlaceholder: settings?.maskPlaceholder ?? "[***]",
            maskValuesOfKeys: settings?.maskValuesOfKeys ?? ["password"],
            maskValuesOfKeysCaseInsensitive: settings?.maskValuesOfKeysCaseInsensitive ?? false,
        };

    }


    public log(logLevelId: number, logLevelName: string, ...args: unknown[]){
        const maskedArgs: unknown[] = (this.settings.maskValuesOfKeys != null && this.settings.maskValuesOfKeys.length > 0) ? this._mask(args) : args;
        const logObj = this._addMetaToLogObj(this._toLogObj(maskedArgs), logLevelId, logLevelName);
        switch (this.settings.type) {
            case "pretty":
                const logMetaMarkup = this._prettyFormatLogObjMeta(logObj?.[this.settings.metaProperty]);
                const logMarkup: any = prettyFormatLogObj(maskedArgs, this.settings.prettyInspectOptions);
                if(typeof logMarkup === "string") { // Node.js (with util.formatWithOptions)
                    this._transport(logMetaMarkup + logMarkup);
                } else if(Array.isArray(logMarkup)) { // Browser (with util.formatWithOptions)
                    const str = logMarkup.shift();
                    this._transport(logMetaMarkup + str, logMarkup);
                } else {
                    this._transport(logMetaMarkup, logMarkup);
                }
            break;
            default:
                this._transportJSON(logObj);
        }

    }

    private _mask(args: unknown[]): unknown[] {

        const maskValuesOfKeys = (this.settings.maskValuesOfKeysCaseInsensitive !== true) ? this.settings.maskValuesOfKeys  : this.settings.maskValuesOfKeys.map(key => key.toLowerCase())
        return args?.map(arg => {
            return this._maskValuesOfKeysRecursive(arg, maskValuesOfKeys, this.settings.maskPlaceholder, this.settings.maskValuesOfKeysCaseInsensitive);
        });
    }

    private _maskValuesOfKeysRecursive<T>(obj: T,
                                          keys: (number | string)[],
                                          maskPlaceholder: string,
                                          maskValuesOfKeysCaseInsensitive: boolean): T {
        if (typeof obj !== 'object' || obj == null) {
            return obj;
        }

        Object.keys(obj).map(key => {
            let thisKey = (maskValuesOfKeysCaseInsensitive !== true) ? key : key.toLowerCase();

            if(keys.includes(thisKey)) {
                obj[key] = maskPlaceholder;
            }

            if (typeof obj[key] === 'object' && obj[key] !== null) {
                this._maskValuesOfKeysRecursive(obj[key], keys, maskPlaceholder, maskValuesOfKeysCaseInsensitive);
            }
        });

        return obj;
    }

    private _toLogObj(args: unknown[]): LogObj {
        let thisLogObj: LogObj = (this.logObj != null) ? structuredClone(this.logObj) : {};
        if (this.settings.argumentsArrayName == null) {
            if(args.length === 1) {
                thisLogObj = (typeof args[0] === "object") ? { ...args[0], ...thisLogObj } : { 0: args[0], ...thisLogObj };
            } else {
                thisLogObj = {...thisLogObj, ...args };
            }

        } else {
            thisLogObj = {
                ...thisLogObj,
                [this.settings.argumentsArrayName]: args
            }
        }
        return thisLogObj;
    }

    private _addMetaToLogObj(logObj: LogObj, logLevelId: number, logLevelName: string) {
        return {
            ...logObj,
            [this.settings.metaProperty]: this.getMeta(logLevelId, logLevelName, this.stackDepthLevel)
        };
    }

    private _prettyFormatLogObjMeta(logObjMeta: any): string {

        let template = String(this.settings.prettyLogTemplate);

        const placeholderValues = {};

        // date and time performance fix
        if(template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
            template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
            placeholderValues["dateIsoStr"] = logObjMeta?.date?.toISOString().replace("T", " ").replace("Z", "");
        } else {
            placeholderValues["yyyy"] = logObjMeta?.date?.getFullYear() ?? "----";
            const dateMonth = logObjMeta?.date?.getMonth();
            placeholderValues["mm"] = (dateMonth == null) ? "--" : (dateMonth < 10) ? "0" + (dateMonth + 1) : (dateMonth + 1);
            const dateDay = logObjMeta?.date ?.getDate();
            placeholderValues["dd"] = (dateDay == null) ? "--" : (dateDay < 10) ? "0" + (dateDay + 1) : (dateDay + 1);
            const dateHours = logObjMeta?.date?.getHours();
            placeholderValues["hh"] = (dateHours == null) ? "--" : (dateHours < 10) ? "0" + dateHours : dateHours;
            const dateMinutes = logObjMeta?.date?.getMinutes();
            placeholderValues["MM"] = (dateMinutes == null) ? "--" : (dateMinutes < 10) ? "0" + dateMinutes : dateMinutes;
            const dateSeconds = logObjMeta?.date?.getSeconds();
            placeholderValues["ss"] = (dateSeconds == null) ? "--" : (dateSeconds < 10) ? "0" + dateSeconds : dateSeconds;
            const dateMilliseconds = logObjMeta?.date?.getMilliseconds();
            placeholderValues["ms"] = (dateMilliseconds == null) ? "--" : (dateMilliseconds < 10) ? "00" + dateMilliseconds : (dateMilliseconds < 100) ? "0" + dateMilliseconds : dateMilliseconds;
        }
        placeholderValues["logLevelName"] = logObjMeta?.logLevelName;
        placeholderValues["filePath"] = logObjMeta?.path?.filePath + ":" + logObjMeta?.path?.fileLine;
        placeholderValues["fullFilePath"] = logObjMeta?.path?.fullFilePath;

        // colorize for server and only for blink browsers
        const ansiColorWrap = (this.runtime !== "browser" || this.isBrowserBlinkEngine) ? (placeholderValue: string, code: [number, number]) => `\u001b[${code[0]}m${placeholderValue}\u001b[${code[1]}m` : (placeholderValue: string) => placeholderValue;

        const styleWrap: (value: string, style: TStyle) => string
            = (value: string, style: TStyle) => {
            if (style != null && typeof style === "string") {
                return ansiColorWrap(value, prettyLogStyles[style]);
            } else if (style != null && Array.isArray(style)) {
                return style.reduce((prevValue: string, thisStyle: string) => styleWrap(prevValue, thisStyle), value);
            } else {
                if(style != null && style[value.trim()] != null) {
                    return styleWrap(value, style[value.trim()]);
                } else if(style != null && style["*"] != null) {
                    return styleWrap(value, style["*"]);
                } else {
                    return value;
                }
            }
        };

        return template.replace(/{{(.+?)}}/g, (_, placeholder) => {
            const value = (placeholderValues[placeholder] != null) ? placeholderValues[placeholder] : _;
            return (this.settings.stylePrettyLogs) ? styleWrap(value, this.settings?.prettyLogStyles?.[placeholder]) + ansiColorWrap("", prettyLogStyles.reset) : value;
        });
    }

    private _transport(markup: string, args?: unknown[]): void {
        if(args != null) {
            console.log(markup, ...args);
        } else {
            console.log(markup);
        }
    }

    private _transportJSON(json: any): void {
        if(this.settings.type !== "hidden") {
            console.log(JSON.stringify(json, null, 2));
        }
    }

}

function structuredClone(obj: any){
    return JSON.parse(JSON.stringify(obj));
}
