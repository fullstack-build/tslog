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

  // Middleware (or a hostile clock) can smuggle a non-Date or an Invalid Date into meta.date. The
  // JSON path renders those as an honest marker; the pretty path must degrade the same way instead of
  // throwing RangeError/TypeError out of the log call. `date` is the validated Date (or undefined),
  // `dateFallback` the marker rendered where an ISO string would go.
  const rawDate = meta.date as unknown;
  const date: Date | undefined = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : undefined;
  let dateFallback: string | undefined;
  if (rawDate != null && date === undefined) {
    if (rawDate instanceof Date) {
      dateFallback = "Invalid Date";
    } else {
      try {
        dateFallback = String(rawDate);
      } catch {
        dateFallback = "Invalid Date";
      }
    }
  }

  if (template.includes("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}")) {
    template = template.replace("{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", "{{dateIsoStr}}");
  } else if (date == null) {
    // No usable date (invalid/non-Date smuggled by middleware): neutral placeholders, never a throw.
    placeholderValues.yyyy = "----";
    placeholderValues.mm = "--";
    placeholderValues.dd = "--";
    placeholderValues.hh = "--";
    placeholderValues.MM = "--";
    placeholderValues.ss = "--";
    placeholderValues.ms = "---";
  } else if (settings.pretty.timeZone === "UTC") {
    placeholderValues.yyyy = date.getUTCFullYear();
    placeholderValues.mm = formatNumberAddZeros(date.getUTCMonth(), 2, 1);
    placeholderValues.dd = formatNumberAddZeros(date.getUTCDate(), 2);
    placeholderValues.hh = formatNumberAddZeros(date.getUTCHours(), 2);
    placeholderValues.MM = formatNumberAddZeros(date.getUTCMinutes(), 2);
    placeholderValues.ss = formatNumberAddZeros(date.getUTCSeconds(), 2);
    placeholderValues.ms = formatNumberAddZeros(date.getUTCMilliseconds(), 3);
  } else {
    placeholderValues.yyyy = date.getFullYear();
    placeholderValues.mm = formatNumberAddZeros(date.getMonth(), 2, 1);
    placeholderValues.dd = formatNumberAddZeros(date.getDate(), 2);
    placeholderValues.hh = formatNumberAddZeros(date.getHours(), 2);
    placeholderValues.MM = formatNumberAddZeros(date.getMinutes(), 2);
    placeholderValues.ss = formatNumberAddZeros(date.getSeconds(), 2);
    placeholderValues.ms = formatNumberAddZeros(date.getMilliseconds(), 3);
  }

  const isUtc = settings.pretty.timeZone === "UTC";
  const dateInSettingsTimeZone = isUtc ? date : date != null ? new Date(date.getTime() - date.getTimezoneOffset() * 60000) : undefined;

  // In local mode the shifted date is "wall clock as UTC"; toISOString() would wrongly suffix "Z".
  // Use the real timezone offset (e.g. +02:00) so rawIsoStr is an accurate local ISO timestamp.
  placeholderValues.rawIsoStr =
    dateInSettingsTimeZone == null ? (dateFallback ?? "") : isUtc ? dateInSettingsTimeZone.toISOString() : localIsoString(dateInSettingsTimeZone, date as Date);
  placeholderValues.dateIsoStr = dateInSettingsTimeZone?.toISOString().replace("T", " ").replace("Z", "") ?? dateFallback ?? "";
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
