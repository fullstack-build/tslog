/**
 * Pretty-log template placeholders recognized by tslog. Used to warn (in development only) about
 * likely typos such as `{{loglevelname}}` instead of `{{logLevelName}}`, and reserved against
 * `pretty.placeholders` so a custom callback can never shadow a built-in token.
 */
export const KNOWN_PRETTY_PLACEHOLDERS = new Set([
  "yyyy",
  "mm",
  "dd",
  "hh",
  "MM",
  "ss",
  "ms",
  "dateIsoStr",
  "rawIsoStr",
  "logLevelName",
  "name",
  "nameWithDelimiterPrefix",
  "nameWithDelimiterSuffix",
  "fullFilePath",
  "filePathWithLine",
  "fileNameWithLine",
  "fileName",
  "filePath",
  "fileLine",
  "fileColumn",
]);

/**
 * Every token `pretty.styles` can style: the meta-template placeholders above plus the error-template
 * (`errorName`, `errorMessage`, `errorStack`) and stack-frame (`method`) fields.
 */
export const KNOWN_PRETTY_STYLE_KEYS = new Set([...KNOWN_PRETTY_PLACEHOLDERS, "errorName", "errorMessage", "errorStack", "method"]);
