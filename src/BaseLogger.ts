import { formatTemplate } from "./formatTemplate.js";
import { formatNumberAddZeros } from "./formatNumberAddZeros.js";
import { ISettingsParam, ISettings, ILogObjMeta, ILogObj, IErrorObject, IRuntime, IMeta } from "./interfaces.js";
import { urlToObject } from "./urlToObj.js";
import Runtime from "./runtime/nodejs/index.js";

export * from "./interfaces.js";
export { Runtime };

export class BaseLogger<LogObj> {
  private readonly runtime: IRuntime;
  public settings: ISettings<LogObj>;
  // not needed yet
  //private subLoggers: BaseLogger<LogObj>[] = [];

  constructor(settings?: ISettingsParam<LogObj>, private logObj?: LogObj, private stackDepthLevel: number = 4) {
    this.runtime = Runtime;

    this.settings = {
      type: settings?.type ?? "pretty",
      name: settings?.name,
      parentNames: settings?.parentNames,
      minLevel: settings?.minLevel ?? 0,
      argumentsArrayName: settings?.argumentsArrayName,
      hideLogPositionForProduction: settings?.hideLogPositionForProduction ?? false,
      prettyLogTemplate:
        settings?.prettyLogTemplate ??
        "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t{{filePathWithLine}}{{nameWithDelimiterPrefix}}\t",
      prettyErrorTemplate: settings?.prettyErrorTemplate ?? "\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}",
      prettyErrorStackTemplate: settings?.prettyErrorStackTemplate ?? "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}",
      prettyErrorParentNamesSeparator: settings?.prettyErrorParentNamesSeparator ?? ":",
      prettyErrorLoggerNameDelimiter: settings?.prettyErrorLoggerNameDelimiter ?? "\t",
      stylePrettyLogs: settings?.stylePrettyLogs ?? true,
      prettyLogTimeZone: settings?.prettyLogTimeZone ?? "UTC",
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
        name: ["white", "bold"],
        nameWithDelimiterPrefix: ["white", "bold"],
        nameWithDelimiterSuffix: ["white", "bold"],
        errorName: ["bold", "bgRedBright", "whiteBright"],
        fileName: ["yellow"],
        fileNameWithLine: "white",
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
        addPlaceholders: settings?.overwrite?.addPlaceholders,
        formatMeta: settings?.overwrite?.formatMeta,
        formatLogObj: settings?.overwrite?.formatLogObj,
        transportFormatted: settings?.overwrite?.transportFormatted,
        transportJSON: settings?.overwrite?.transportJSON,
      },
    };
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
    // execute default LogObj functions for every log (e.g. requestId)
    const thisLogObj: LogObj | undefined = this.logObj != null ? this._recursiveCloneAndExecuteFunctions(this.logObj) : undefined;
    const logObj: LogObj =
      this.settings.overwrite?.toLogObj != null ? this.settings.overwrite?.toLogObj(maskedArgs, thisLogObj) : this._toLogObj(maskedArgs, thisLogObj);
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
      logMetaMarkup = logMetaMarkup ?? this._prettyFormatLogObjMeta(logObjWithMeta?.[this.settings.metaProperty]);
      logArgsAndErrorsMarkup = logArgsAndErrorsMarkup ?? this.runtime.prettyFormatLogObj(maskedArgs, this.settings);
    }

    if (logMetaMarkup != null && logArgsAndErrorsMarkup != null) {
      this.settings.overwrite?.transportFormatted != null
        ? this.settings.overwrite?.transportFormatted(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, this.settings)
        : this.runtime.transportFormatted(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, this.settings);
    } else {
      // overwrite transport no matter what, hide only with default transport
      this.settings.overwrite?.transportJSON != null
        ? this.settings.overwrite?.transportJSON(logObjWithMeta)
        : this.settings.type !== "hidden"
        ? this.runtime.transportJSON(logObjWithMeta)
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
   * @param logObj - Overwrite logObj for sub-logger
   */
  public getSubLogger(settings?: ISettingsParam<LogObj>, logObj?: LogObj): BaseLogger<LogObj> {
    const subLoggerSettings: ISettings<LogObj> = {
      ...this.settings,
      ...settings,
      // collect parent names in Array
      parentNames:
        this.settings?.parentNames != null && this.settings?.name != null
          ? [...this.settings.parentNames, this.settings.name]
          : this.settings?.name != null
          ? [this.settings.name]
          : undefined,
      // merge all prefixes instead of overwriting them
      prefix: [...this.settings.prefix, ...(settings?.prefix ?? [])],
    };

    const subLogger: BaseLogger<LogObj> = new (this.constructor as new (
      subLoggerSettings?: ISettingsParam<LogObj>,
      logObj?: LogObj,
      stackDepthLevel?: number
    ) => this)(subLoggerSettings, logObj ?? this.logObj, this.stackDepthLevel);
    //this.subLoggers.push(subLogger);
    return subLogger;
  }

  private _mask(args: unknown[]): unknown[] {
    const maskValuesOfKeys =
      this.settings.maskValuesOfKeysCaseInsensitive !== true ? this.settings.maskValuesOfKeys : this.settings.maskValuesOfKeys.map((key) => key.toLowerCase());
    return args?.map((arg) => {
      return this._recursiveCloneAndMaskValuesOfKeys(arg, maskValuesOfKeys);
    });
  }

  private _recursiveCloneAndMaskValuesOfKeys<T>(source: T, keys: (number | string)[], seen: unknown[] = []): T {
    if (seen.includes(source)) {
      return { ...source } as T;
    }
    if (typeof source === "object" && source !== null) {
      seen.push(source);
    }

    if (this.runtime.isError(source) || this.runtime.isBuffer(source)) {
      return source as T;
    } else if (source instanceof Map) {
      return new Map(source) as T;
    } else if (source instanceof Set) {
      return new Set(source) as T;
    } else if (Array.isArray(source)) {
      return source.map((item) => this._recursiveCloneAndMaskValuesOfKeys(item, keys, seen)) as unknown as T;
    } else if (source instanceof Date) {
      return new Date(source.getTime()) as T;
    } else if (source instanceof URL) {
      return urlToObject(source) as T;
    } else if (source !== null && typeof source === "object") {
      const baseObject = this.runtime.isError(source) ? this._cloneError(source as unknown as Error) : Object.create(Object.getPrototypeOf(source));
      return Object.getOwnPropertyNames(source).reduce((o, prop) => {
        o[prop] = keys.includes(this.settings?.maskValuesOfKeysCaseInsensitive !== true ? prop : prop.toLowerCase())
          ? this.settings.maskPlaceholder
          : this._recursiveCloneAndMaskValuesOfKeys((source as Record<string, unknown>)[prop], keys, seen);
        return o;
      }, baseObject) as T;
    } else {
      if (typeof source === "string") {
        let modifiedSource: string = source;
        for (const regEx of this.settings?.maskValuesRegEx || []) {
          modifiedSource = modifiedSource.replace(regEx, this.settings?.maskPlaceholder || "");
        }
        return modifiedSource as unknown as T;
      }
      return source;
    }
  }

  private _recursiveCloneAndExecuteFunctions<T>(source: T, seen: (object | Array<unknown>)[] = []): T {
    if (this.isObjectOrArray(source) && seen.includes(source)) {
      return this.shallowCopy(source);
    }

    if (this.isObjectOrArray(source)) {
      seen.push(source);
    }

    if (Array.isArray(source)) {
      return source.map((item) => this._recursiveCloneAndExecuteFunctions(item, seen)) as unknown as T;
    } else if (source instanceof Date) {
      return new Date(source.getTime()) as unknown as T;
    } else if (this.isObject(source)) {
      return Object.getOwnPropertyNames(source).reduce((o, prop) => {
        const descriptor = Object.getOwnPropertyDescriptor(source, prop);
        if (descriptor) {
          Object.defineProperty(o, prop, descriptor);
          const value = (source as Record<string, unknown>)[prop];
          o[prop] = typeof value === "function" ? value() : this._recursiveCloneAndExecuteFunctions(value, seen);
        }
        return o;
      }, Object.create(Object.getPrototypeOf(source))) as T;
    } else {
      return source;
    }
  }

  private isObjectOrArray(value: unknown): value is object | unknown[] {
    return typeof value === "object" && value !== null;
  }

  private isObject(value: unknown): value is object {
    return typeof value === "object" && !Array.isArray(value) && value !== null;
  }

  private shallowCopy<T>(source: T): T {
    if (Array.isArray(source)) {
      return [...source] as unknown as T;
    } else {
      return { ...source } as unknown as T;
    }
  }

  private _toLogObj(args: unknown[], clonedLogObj: LogObj = {} as LogObj): LogObj {
    args = args?.map((arg) => (this.runtime.isError(arg) ? this._toErrorObject(arg as Error) : arg));
    if (this.settings.argumentsArrayName == null) {
      if (args.length === 1 && !Array.isArray(args[0]) && this.runtime.isBuffer(args[0]) !== true && !(args[0] instanceof Date)) {
        clonedLogObj = typeof args[0] === "object" && args[0] != null ? { ...args[0], ...clonedLogObj } : { 0: args[0], ...clonedLogObj };
      } else {
        clonedLogObj = { ...clonedLogObj, ...args };
      }
    } else {
      clonedLogObj = {
        ...clonedLogObj,
        [this.settings.argumentsArrayName]: args,
      };
    }
    return clonedLogObj;
  }

  private _cloneError<T extends Error>(error: T): T {
    const cloned = new (error.constructor as { new (): T })();

    Object.getOwnPropertyNames(error).forEach((key) => {
      (cloned as any)[key] = (error as any)[key];
    });

    return cloned;
  }

  private _toErrorObject(error: Error): IErrorObject {
    return {
      nativeError: error,
      name: error.name ?? "Error",
      message: error.message,
      stack: this.runtime.getErrorTrace(error),
    };
  }

  private _addMetaToLogObj(logObj: LogObj, logLevelId: number, logLevelName: string): LogObj & ILogObjMeta & ILogObj {
    return {
      ...logObj,
      [this.settings.metaProperty]: this.runtime.getMeta(
        logLevelId,
        logLevelName,
        this.stackDepthLevel,
        this.settings.hideLogPositionForProduction,
        this.settings.name,
        this.settings.parentNames
      ),
    };
  }

  private _prettyFormatLogObjMeta(logObjMeta?: IMeta): string {
    if (logObjMeta == null) {
      return "";
    }

    let template = this.settings.prettyLogTemplate;

    const placeholderValues: Record<string, string | number> = {};

    // date and time performance fix
    if (template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
      template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
    } else {
      if (this.settings.prettyLogTimeZone === "UTC") {
        placeholderValues["yyyy"] = logObjMeta?.date?.getUTCFullYear() ?? "----";
        placeholderValues["mm"] = formatNumberAddZeros(logObjMeta?.date?.getUTCMonth(), 2, 1);
        placeholderValues["dd"] = formatNumberAddZeros(logObjMeta?.date?.getUTCDate(), 2);
        placeholderValues["hh"] = formatNumberAddZeros(logObjMeta?.date?.getUTCHours(), 2);
        placeholderValues["MM"] = formatNumberAddZeros(logObjMeta?.date?.getUTCMinutes(), 2);
        placeholderValues["ss"] = formatNumberAddZeros(logObjMeta?.date?.getUTCSeconds(), 2);
        placeholderValues["ms"] = formatNumberAddZeros(logObjMeta?.date?.getUTCMilliseconds(), 3);
      } else {
        placeholderValues["yyyy"] = logObjMeta?.date?.getFullYear() ?? "----";
        placeholderValues["mm"] = formatNumberAddZeros(logObjMeta?.date?.getMonth(), 2, 1);
        placeholderValues["dd"] = formatNumberAddZeros(logObjMeta?.date?.getDate(), 2);
        placeholderValues["hh"] = formatNumberAddZeros(logObjMeta?.date?.getHours(), 2);
        placeholderValues["MM"] = formatNumberAddZeros(logObjMeta?.date?.getMinutes(), 2);
        placeholderValues["ss"] = formatNumberAddZeros(logObjMeta?.date?.getSeconds(), 2);
        placeholderValues["ms"] = formatNumberAddZeros(logObjMeta?.date?.getMilliseconds(), 3);
      }
    }
    const dateInSettingsTimeZone =
      this.settings.prettyLogTimeZone === "UTC" ? logObjMeta?.date : new Date(logObjMeta?.date?.getTime() - logObjMeta?.date?.getTimezoneOffset() * 60000);
    placeholderValues["rawIsoStr"] = dateInSettingsTimeZone?.toISOString();
    placeholderValues["dateIsoStr"] = dateInSettingsTimeZone?.toISOString().replace("T", " ").replace("Z", "");
    placeholderValues["logLevelName"] = logObjMeta?.logLevelName;
    placeholderValues["fileNameWithLine"] = logObjMeta?.path?.fileNameWithLine ?? "";
    placeholderValues["filePathWithLine"] = logObjMeta?.path?.filePathWithLine ?? "";
    placeholderValues["fullFilePath"] = logObjMeta?.path?.fullFilePath ?? "";
    // name
    let parentNamesString = this.settings.parentNames?.join(this.settings.prettyErrorParentNamesSeparator);
    parentNamesString = parentNamesString != null && logObjMeta?.name != null ? parentNamesString + this.settings.prettyErrorParentNamesSeparator : undefined;
    placeholderValues["name"] = logObjMeta?.name != null || parentNamesString != null ? (parentNamesString ?? "") + logObjMeta?.name ?? "" : "";
    placeholderValues["nameWithDelimiterPrefix"] =
      placeholderValues["name"].length > 0 ? this.settings.prettyErrorLoggerNameDelimiter + placeholderValues["name"] : "";
    placeholderValues["nameWithDelimiterSuffix"] =
      placeholderValues["name"].length > 0 ? placeholderValues["name"] + this.settings.prettyErrorLoggerNameDelimiter : "";

    if (this.settings.overwrite?.addPlaceholders != null) {
      this.settings.overwrite?.addPlaceholders(logObjMeta, placeholderValues);
    }

    return formatTemplate(this.settings, template, placeholderValues);
  }
}
