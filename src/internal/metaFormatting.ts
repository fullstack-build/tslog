import { formatTemplate } from "../formatTemplate.js";
import { formatNumberAddZeros } from "../formatNumberAddZeros.js";
import { IMeta, ISettings } from "../interfaces.js";

export interface PrettyMetaRenderResult {
  text: string;
  template: string;
  placeholders: Record<string, string | number>;
}

export function buildPrettyMeta<LogObj>(settings: ISettings<LogObj>, meta?: IMeta): PrettyMetaRenderResult {
  if (meta == null) {
    return {
      text: "",
      template: settings.prettyLogTemplate,
      placeholders: {},
    };
  }

  let template = settings.prettyLogTemplate;
  const placeholderValues: Record<string, string | number> = {};

  if (template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
    template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
  } else {
    if (settings.prettyLogTimeZone === "UTC") {
      placeholderValues["yyyy"] = meta.date?.getUTCFullYear() ?? "----";
      placeholderValues["mm"] = formatNumberAddZeros(meta.date?.getUTCMonth(), 2, 1);
      placeholderValues["dd"] = formatNumberAddZeros(meta.date?.getUTCDate(), 2);
      placeholderValues["hh"] = formatNumberAddZeros(meta.date?.getUTCHours(), 2);
      placeholderValues["MM"] = formatNumberAddZeros(meta.date?.getUTCMinutes(), 2);
      placeholderValues["ss"] = formatNumberAddZeros(meta.date?.getUTCSeconds(), 2);
      placeholderValues["ms"] = formatNumberAddZeros(meta.date?.getUTCMilliseconds(), 3);
    } else {
      placeholderValues["yyyy"] = meta.date?.getFullYear() ?? "----";
      placeholderValues["mm"] = formatNumberAddZeros(meta.date?.getMonth(), 2, 1);
      placeholderValues["dd"] = formatNumberAddZeros(meta.date?.getDate(), 2);
      placeholderValues["hh"] = formatNumberAddZeros(meta.date?.getHours(), 2);
      placeholderValues["MM"] = formatNumberAddZeros(meta.date?.getMinutes(), 2);
      placeholderValues["ss"] = formatNumberAddZeros(meta.date?.getSeconds(), 2);
      placeholderValues["ms"] = formatNumberAddZeros(meta.date?.getMilliseconds(), 3);
    }
  }

  const dateInSettingsTimeZone =
    settings.prettyLogTimeZone === "UTC" ? meta.date : meta.date != null ? new Date(meta.date.getTime() - meta.date.getTimezoneOffset() * 60000) : undefined;

  placeholderValues["rawIsoStr"] = dateInSettingsTimeZone?.toISOString() ?? "";
  placeholderValues["dateIsoStr"] = dateInSettingsTimeZone?.toISOString().replace("T", " ").replace("Z", "") ?? "";
  placeholderValues["logLevelName"] = meta.logLevelName;
  placeholderValues["fileNameWithLine"] = meta.path?.fileNameWithLine ?? "";
  placeholderValues["filePathWithLine"] = meta.path?.filePathWithLine ?? "";
  placeholderValues["fullFilePath"] = meta.path?.fullFilePath ?? "";

  let parentNamesString = settings.parentNames?.join(settings.prettyErrorParentNamesSeparator);
  parentNamesString = parentNamesString != null && meta.name != null ? parentNamesString + settings.prettyErrorParentNamesSeparator : undefined;

  const combinedName = meta.name != null || parentNamesString != null ? `${parentNamesString ?? ""}${meta.name ?? ""}` : "";

  placeholderValues["name"] = combinedName;
  placeholderValues["nameWithDelimiterPrefix"] = combinedName.length > 0 ? settings.prettyErrorLoggerNameDelimiter + combinedName : "";
  placeholderValues["nameWithDelimiterSuffix"] = combinedName.length > 0 ? combinedName + settings.prettyErrorLoggerNameDelimiter : "";

  if (settings.overwrite?.addPlaceholders != null) {
    settings.overwrite.addPlaceholders(meta, placeholderValues);
  }

  return {
    text: formatTemplate(settings, template, placeholderValues),
    template,
    placeholders: placeholderValues,
  };
}
