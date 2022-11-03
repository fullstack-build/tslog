import { getMeta, getErrorTrace, transportFormatted, transportJSON, prettyFormatLogObj, IMeta, isError } from "./runtime/nodejs";
import { formatTemplate } from "./formatTemplate";
import { formatNumberAddZeros } from "./formatNumberAddZeros";
import { ISettingsParam, ISettings, ILogObjMeta, ILogObj, IErrorObject } from "./interfaces";
export * from "./interfaces";

export class BaseLogger<LogObj> {
  private readonly runtime: "browser" | "nodejs" | "unknown";
  private readonly settings: ISettings<LogObj>;
  private subLogger: BaseLogger<LogObj>[] = [];

  constructor(settings?: ISettingsParam<LogObj>, private logObj?: LogObj, private stackDepthLevel: number = 4) {
    const isBrowser = ![typeof window, typeof document].includes("undefined");
    const isNode = Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";
    this.runtime = isBrowser ? "browser" : isNode ? "nodejs" : "unknown";
    const isBrowserBlinkEngine = isBrowser ? ((window?.["chrome"] || (window.Intl && Intl?.["v8BreakIterator"])) && "CSS" in window) != null : false;
    const isSafari = isBrowser ? /^((?!chrome|android).)*safari/i.test(navigator.userAgent) : false;
    this.stackDepthLevel = isSafari ? 4 : this.stackDepthLevel;

    this.settings = {
      type: settings?.type ?? "pretty",
      minLevel: settings?.minLevel ?? 0,
      argumentsArrayName: settings?.argumentsArrayName,
      prettyLogTemplate: settings?.prettyLogTemplate ?? "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{filePathWithLine}}]\t",
      prettyErrorTemplate: settings?.prettyErrorTemplate ?? "\n{{errorName}} {{errorMessage}}\n\nerror stack:\n{{errorStack}}",
      prettyErrorStackTemplate: settings?.prettyErrorTemplate ?? "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}",
      stylePrettyLogs: settings?.stylePrettyLogs ?? true,
      prettyLogStyles: settings?.prettyLogStyles ?? {
        logLevelName: {
          "*": ["bold", "black", "bgWhiteBright", "dim"],
          SILLY: ["bold", "white"],
          TRACE: ["bold", "whiteBright"],
          DEBUG: ["bold", "green"],
          INFO: ["bold", "blue"],
          WARN: ["bold", "yellow"],
          ERROR: ["bold", "red"],
          FATAL: ["bold", "redBright"],
        },
        dateIsoStr: "white",
        filePathWithLine: "white",
        errorName: ["bold", "bgRedBright", "whiteBright"],
        fileName: ["yellow"],
      },
      prettyInspectOptions: settings?.prettyInspectOptions ?? {
        colors: true,
        compact: false,
        depth: Infinity,
      },
      metaProperty: settings?.metaProperty ?? "_meta",
      maskPlaceholder: settings?.maskPlaceholder ?? "[***]",
      maskValuesOfKeys: settings?.maskValuesOfKeys ?? ["password"],
      maskValuesOfKeysCaseInsensitive: settings?.maskValuesOfKeysCaseInsensitive ?? false,
      maskValuesRegEx: settings?.maskValuesRegEx,
      prefix: [...(settings?.prefix ?? [])],
      attachedTransports: [...(settings?.attachedTransports ?? [])],
      overwrite: {
        mask: settings?.overwrite?.mask,
        toLogObj: settings?.overwrite?.toLogObj,
        addMeta: settings?.overwrite?.addMeta,
        formatMeta: settings?.overwrite?.formatMeta,
        formatLogObj: settings?.overwrite?.formatLogObj,
        transportFormatted: settings?.overwrite?.transportFormatted,
        transportJSON: settings?.overwrite?.transportJSON,
      },
    };

    // style only for server and blink browsers
    this.settings.stylePrettyLogs = this.settings.stylePrettyLogs && isBrowser && !isBrowserBlinkEngine ? false : this.settings.stylePrettyLogs;
  }

  /**
   * Logs a message with a custom log level.
   * @param logLevelId    - Log level ID e.g. 0
   * @param logLevelName  - Log level name e.g. silly
   * @param args          - Multiple log attributes that should be logged out.
   * @return LogObject with meta property, when log level is >= minLevel
   */
  public log(logLevelId: number, logLevelName: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    if (logLevelId < this.settings.minLevel) {
      return;
    }
    const logArgs = [...this.settings.prefix, ...args];
    const maskedArgs: unknown[] =
      this.settings.overwrite?.mask != null
        ? this.settings.overwrite?.mask(logArgs)
        : this.settings.maskValuesOfKeys != null && this.settings.maskValuesOfKeys.length > 0
        ? this._mask(logArgs)
        : logArgs;
    const logObj: LogObj = this.settings.overwrite?.toLogObj != null ? this.settings.overwrite?.toLogObj(maskedArgs) : this._toLogObj(maskedArgs);
    const logObjWithMeta: LogObj & ILogObjMeta =
      this.settings.overwrite?.addMeta != null
        ? this.settings.overwrite?.addMeta(logObj, logLevelId, logLevelName)
        : this._addMetaToLogObj(logObj, logLevelId, logLevelName);

    // overwrite no matter what, should work for any type (pretty, json, ...)
    let logMetaMarkup;
    let logArgsAndErrorsMarkup: { args: unknown[]; errors: string[] } | undefined = undefined;
    if (this.settings.overwrite?.formatMeta != null) {
      logMetaMarkup = this.settings.overwrite?.formatMeta(logObjWithMeta?.[this.settings.metaProperty]);
    }
    if (this.settings.overwrite?.formatLogObj != null) {
      logArgsAndErrorsMarkup = this.settings.overwrite?.formatLogObj(maskedArgs, this.settings);
    }

    if (this.settings.type === "pretty") {
      logMetaMarkup = this._prettyFormatLogObjMeta(logObjWithMeta?.[this.settings.metaProperty]);
      logArgsAndErrorsMarkup = prettyFormatLogObj(maskedArgs, this.settings);
    }

    if (logMetaMarkup != null && logArgsAndErrorsMarkup != null) {
      this.settings.overwrite?.transportFormatted != null
        ? this.settings.overwrite?.transportFormatted(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, this.settings)
        : transportFormatted(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, this.settings);
    } else {
      // overwrite transport no matter what, hide only with default transport
      this.settings.overwrite?.transportJSON != null
        ? this.settings.overwrite?.transportJSON(logObjWithMeta)
        : this.settings.type !== "hidden"
        ? transportJSON(logObjWithMeta)
        : undefined;
    }

    if (this.settings.attachedTransports != null && this.settings.attachedTransports.length > 0) {
      this.settings.attachedTransports.forEach((transportLogger) => {
        transportLogger(logObjWithMeta);
      });
    }

    return logObjWithMeta;
  }

  /**
   *  Attaches external Loggers, e.g. external log services, file system, database
   *
   * @param transportLogger - External logger to be attached. Must implement all log methods.
   */
  public attachTransport(transportLogger: (transportLogger: LogObj & ILogObjMeta) => void): void {
    this.settings.attachedTransports.push(transportLogger);
  }

  /**
   *  Returns a child logger based on the current instance with inherited settings
   *
   * @param settings - Overwrite settings inherited from parent logger
   */
  public getSubLogger(settings?: ISettingsParam<LogObj>): BaseLogger<LogObj> {
    const subLoggerSettings: ISettings<LogObj> = {
      ...this.settings,
      ...settings,
      // merge all prefixes instead of overwriting them
      prefix: [...this.settings.prefix, ...(settings?.prefix ?? [])],
    };

    const subLogger: BaseLogger<LogObj> = new (this.constructor as new (childSettings?: ISettingsParam<LogObj>) => this)(subLoggerSettings);
    this.subLogger.push(subLogger);
    return subLogger;
  }

  private _mask(args: unknown[]): unknown[] {
    const maskValuesOfKeys =
      this.settings.maskValuesOfKeysCaseInsensitive !== true ? this.settings.maskValuesOfKeys : this.settings.maskValuesOfKeys.map((key) => key.toLowerCase());
    return args?.map((arg) => {
      return this._maskValuesOfKeysRecursive(arg, maskValuesOfKeys);
    });
  }

  private _maskValuesOfKeysRecursive<T>(obj: T, keys: (number | string)[], seen: unknown[] = []): T {
    if (typeof obj !== "object" || obj == null) {
      return obj;
    }
    if (seen.includes(obj)) {
      return obj;
    }
    seen.push(obj);

    Object.keys(obj).map((key) => {
      const thisKey = this.settings?.maskValuesOfKeysCaseInsensitive !== true ? key : key.toLowerCase();

      this.settings?.maskValuesRegEx?.forEach((regEx) => {
        obj[key] = obj[key].replace(regEx, this.settings.maskPlaceholder);
      });

      if (keys.includes(thisKey)) {
        obj[key] = this.settings.maskPlaceholder;
      }

      if (typeof obj[key] === "object" && obj[key] !== null) {
        this._maskValuesOfKeysRecursive(obj[key], keys, seen);
      }
    });

    return obj;
  }

  private _toLogObj(args: unknown[]): LogObj {
    let thisLogObj: LogObj = this.logObj != null ? structuredClone(this.logObj) : {};
    args = args?.map((arg) => (isError(arg) ? this._toErrorObject(arg as Error) : arg));

    if (this.settings.argumentsArrayName == null) {
      if (args.length === 1) {
        thisLogObj = typeof args[0] === "object" ? { ...args[0], ...thisLogObj } : { 0: args[0], ...thisLogObj };
      } else {
        thisLogObj = { ...thisLogObj, ...args };
      }
    } else {
      thisLogObj = {
        ...thisLogObj,
        [this.settings.argumentsArrayName]: args,
      };
    }
    return thisLogObj;
  }

  private _toErrorObject(error: Error): IErrorObject {
    return {
      nativeError: error,
      name: error.name ?? "Error",
      message: error.message,
      stack: getErrorTrace(error),
    };
  }

  private _addMetaToLogObj(logObj: LogObj, logLevelId: number, logLevelName: string): LogObj & ILogObjMeta & ILogObj {
    return {
      ...logObj,
      [this.settings.metaProperty]: getMeta(logLevelId, logLevelName, this.stackDepthLevel),
    };
  }

  private _prettyFormatLogObjMeta(logObjMeta?: IMeta): string {
    if (logObjMeta == null) {
      return "";
    }

    let template = this.settings.prettyLogTemplate;

    const placeholderValues = {};

    // date and time performance fix
    if (template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
      template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
      placeholderValues["dateIsoStr"] = logObjMeta?.date?.toISOString().replace("T", " ").replace("Z", "");
    } else {
      placeholderValues["yyyy"] = logObjMeta?.date?.getFullYear() ?? "----";
      placeholderValues["mm"] = formatNumberAddZeros(logObjMeta?.date?.getMonth(), 2, 1);
      placeholderValues["dd"] = formatNumberAddZeros(logObjMeta?.date?.getDate(), 2, 1);
      placeholderValues["hh"] = formatNumberAddZeros(logObjMeta?.date?.getHours(), 2);
      placeholderValues["MM"] = formatNumberAddZeros(logObjMeta?.date?.getMinutes(), 2);
      placeholderValues["ss"] = formatNumberAddZeros(logObjMeta?.date?.getSeconds(), 2);
      placeholderValues["ms"] = formatNumberAddZeros(logObjMeta?.date?.getMilliseconds(), 3);
    }
    placeholderValues["logLevelName"] = logObjMeta?.logLevelName;
    placeholderValues["filePathWithLine"] = logObjMeta?.path?.filePathWithLine;
    placeholderValues["fullFilePath"] = logObjMeta?.path?.fullFilePath;

    return formatTemplate(this.settings, template, placeholderValues);
  }
}

function structuredClone(obj: unknown) {
  return JSON.parse(JSON.stringify(obj));
}
