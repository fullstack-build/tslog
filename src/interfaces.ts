import { IMeta, InspectOptions } from "./runtime/nodejs";

export type TStyle =
  | null
  | string
  | string[]
  | {
      [value: string]: null | string | string[];
    };

export interface ISettingsParam<LogObj> {
  type?: "json" | "pretty" | "hidden";
  argumentsArrayName?: string;
  prettyLogTemplate?: string;
  stylePrettyLogs?: boolean;
  prettyLogStyles?: {
    yyyy?: TStyle;
    mm?: TStyle;
    dd?: TStyle;
    hh?: TStyle;
    MM?: TStyle;
    ss?: TStyle;
    ms?: TStyle;
    dateIsoStr?: TStyle;
    logLevelName?: TStyle;
    filePath?: TStyle;
    fileLine?: TStyle;
  };
  metaProperty?: string;
  prettyInspectOptions?: InspectOptions;
  maskPlaceholder?: string;
  maskValuesOfKeys?: string[];
  maskValuesOfKeysCaseInsensitive?: boolean;
  overwrite?: {
    mask?: (args: unknown[]) => unknown[];
    toLogObj?: (args: unknown[]) => LogObj;
    addMeta?: (logObj: LogObj, logLevelId: number, logLevelName: string) => LogObj & ILogObjMeta;
    formatMeta?: (meta?: IMeta) => string;
    formatLogObj?: (maskedArgs: unknown[], prettyInspectOptions: InspectOptions) => string;
    transportFormatted?: (logMetaMarkup: string, logMarkup: string) => void;
    transportJSON?: (json: unknown) => void;
  };
  /**  Array of attached Transports. Use Method `attachTransport` to attach transports. */
  attachedTransports?: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
}

export interface ISettings<LogObj> extends ISettingsParam<LogObj> {
  type: "json" | "pretty" | "hidden";
  argumentsArrayName?: string;
  prettyLogTemplate: string;
  stylePrettyLogs: boolean;
  prettyLogStyles: {
    yyyy?: TStyle;
    mm?: TStyle;
    dd?: TStyle;
    hh?: TStyle;
    MM?: TStyle;
    ss?: TStyle;
    ms?: TStyle;
    dateIsoStr?: TStyle;
    logLevelName?: TStyle;
    filePath?: TStyle;
    fileLine?: TStyle;
  };
  metaProperty: string;
  prettyInspectOptions: InspectOptions;
  maskPlaceholder: string;
  maskValuesOfKeys: string[];
  maskValuesOfKeysCaseInsensitive: boolean;
  attachedTransports: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  prefix: unknown[];
}

export interface ILogObjMeta {
  [name: string]: IMeta;
}

export interface ITrace {
  fullFilePath?: string;
  filePath?: string;
  fileLine?: string;
}
