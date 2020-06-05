# Change Log - tslog

## 2.2.0: 
Sun, 05 Jun 2020
Added additional output settings: 
* dateTimePattern: DateTime pattern based on Intl.DateTimeFormat.formatToParts with additional milliseconds, default: `year-month-day hour:minute:second.millisecond`
* dateTimeTimezone: DateTime timezone, e.g. `utc`, or `Europe/Berlin`, `Europe/Moscow`. You can use `Intl.DateTimeFormat().resolvedOptions().timeZone` for local timezone, default: "utc"
* printLogMessageInNewLine: Print log message in a new line below meta information, default: `false`
* displayDateTime: Display date time at the beginning of a log message, default: `true`
* displayLogLevel: Display log level, default: `true`
* displayInstanceName: Display instanceName or not, default: `false`
* displayLoggerName: Display name of the logger. Will only be visible if `name` was set, default: `true`
* displayFilePath: Display file path ("hidden" | "displayAll" | "hideNodeModulesOnly"), default "hideNodeModulesOnly"
* displayFunctionName: Display function name, default: `true`

## 2.1.0: 
Sun, 26 Mai 2020
- Exposed helper method `prettyError` that helps pretty-printing an error without logging with various options 
- Adjust default error colors

## 2.0.0: 
Sun, 24 Mai 2020
- Setting `logAsJson` replaced with `type` = `pretty` | `json` ('pretty' is default)
- `chalk` dependency removed (hexadecimal colors are no longer supported)
- Color settings based on Node.js `utils.inspect.colors` 
- Error object displays additional `details` and exposes `nativeError`
- When `type` is set to `json`, hide `nativeError` and expose stringified version as `errorString`

## 1.0.0
Thu, 30 Apr 2020

*Initial release*

