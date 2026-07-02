import { formatNumberAddZeros } from "../formatNumberAddZeros.js";
import { formatTemplate } from "../formatTemplate.js";
import type { IMeta, ISettings } from "../interfaces.js";

export interface PrettyMetaRenderResult {
  text: string;
  template: string;
  placeholders: Record<string, string | number>;
}

export function buildPrettyMeta<LogObj>(settings: ISettings<LogObj>, meta?: IMeta): PrettyMetaRenderResult {
  if (meta == null) {
    return {
      text: "",
      template: settings.pretty.template,
      placeholders: {},
    };
  }

  let template = settings.pretty.template;
  const placeholderValues: Record<string, string | number> = {};

  if (template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
    template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
  } else {
    if (settings.pretty.timeZone === "UTC") {
      placeholderValues.yyyy = meta.date?.getUTCFullYear() ?? "----";
      placeholderValues.mm = formatNumberAddZeros(meta.date?.getUTCMonth(), 2, 1);
      placeholderValues.dd = formatNumberAddZeros(meta.date?.getUTCDate(), 2);
      placeholderValues.hh = formatNumberAddZeros(meta.date?.getUTCHours(), 2);
      placeholderValues.MM = formatNumberAddZeros(meta.date?.getUTCMinutes(), 2);
      placeholderValues.ss = formatNumberAddZeros(meta.date?.getUTCSeconds(), 2);
      placeholderValues.ms = formatNumberAddZeros(meta.date?.getUTCMilliseconds(), 3);
    } else {
      placeholderValues.yyyy = meta.date?.getFullYear() ?? "----";
      placeholderValues.mm = formatNumberAddZeros(meta.date?.getMonth(), 2, 1);
      placeholderValues.dd = formatNumberAddZeros(meta.date?.getDate(), 2);
      placeholderValues.hh = formatNumberAddZeros(meta.date?.getHours(), 2);
      placeholderValues.MM = formatNumberAddZeros(meta.date?.getMinutes(), 2);
      placeholderValues.ss = formatNumberAddZeros(meta.date?.getSeconds(), 2);
      placeholderValues.ms = formatNumberAddZeros(meta.date?.getMilliseconds(), 3);
    }
  }

  const isUtc = settings.pretty.timeZone === "UTC";
  const dateInSettingsTimeZone = isUtc ? meta.date : meta.date != null ? new Date(meta.date.getTime() - meta.date.getTimezoneOffset() * 60000) : undefined;

  // In local mode the shifted date is "wall clock as UTC"; toISOString() would wrongly suffix "Z".
  // Use the real timezone offset (e.g. +02:00) so rawIsoStr is an accurate local ISO timestamp.
  placeholderValues.rawIsoStr =
    dateInSettingsTimeZone == null ? "" : isUtc ? dateInSettingsTimeZone.toISOString() : localIsoString(dateInSettingsTimeZone, meta.date);
  placeholderValues.dateIsoStr = dateInSettingsTimeZone?.toISOString().replace("T", " ").replace("Z", "") ?? "";
  placeholderValues.logLevelName = meta.logLevelName;
  placeholderValues.fileNameWithLine = meta.path?.fileNameWithLine ?? "";
  placeholderValues.filePathWithLine = meta.path?.filePathWithLine ?? "";
  placeholderValues.fullFilePath = meta.path?.fullFilePath ?? "";

  let parentNamesString = settings.parentNames?.join(settings.pretty.errorParentNamesSeparator);
  parentNamesString = parentNamesString != null && meta.name != null ? parentNamesString + settings.pretty.errorParentNamesSeparator : undefined;

  /* v8 ignore next -- defensive: parentNamesString is only set when meta.name is also set (see line above), so the meta.name ?? "" fallback is unreachable */
  const combinedName = meta.name != null || parentNamesString != null ? `${parentNamesString ?? ""}${meta.name ?? ""}` : "";

  placeholderValues.name = combinedName;
  placeholderValues.nameWithDelimiterPrefix = combinedName.length > 0 ? settings.pretty.errorLoggerNameDelimiter + combinedName : "";
  placeholderValues.nameWithDelimiterSuffix = combinedName.length > 0 ? combinedName + settings.pretty.errorLoggerNameDelimiter : "";

  return {
    text: formatTemplate(settings, template, placeholderValues),
    template,
    placeholders: placeholderValues,
  };
}

/**
 * Build an ISO 8601 string for a local timestamp with the real timezone offset suffix (e.g. 2023-01-19T13:05:37.263+02:00).
 * `shifted` carries the local wall-clock digits as if they were UTC; `original` provides the actual offset.
 */
function localIsoString(shifted: Date, original: Date): string {
  const base = shifted.toISOString().replace("Z", "");
  const offsetMinutes = -original.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${base}${sign}${hh}:${mm}`;
}
