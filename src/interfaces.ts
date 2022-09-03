import {InspectOptions} from "./runtime/nodejs";

export type TStyle = null | string | string[] | {
    [value:string] : null | string | string[]
};

export interface ISettingsProperties {
    type?: "json" | "pretty" | "hidden";
    argumentsArrayName?: string;
    prettyLogTemplate?: string;
    stylePrettyLogs?: boolean;
    prettyLogStyles?: {
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
    metaProperty?: string;
    prettyInspectOptions?: InspectOptions;
    maskPlaceholder?: string;
    maskValuesOfKeys?: string[];
    maskValuesOfKeysCaseInsensitive?: boolean;
}

export interface ISettings extends ISettingsProperties{
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
