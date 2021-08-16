# Change Log - tslog

## 2.6.0:

Mon, 29 Jun 2020

- Add new type: `hidden`

## 2.5.0:

Sat, 20 Jun 2020
_This is a jam-packed release 🎉_

_Don't underestimate this minor version jump, it's only due to semver and its backward compatibility reasons. ;-)._

- **Child Loggers:** Use `getChildLogger` to create a child logger based on the current instance, inherit all its settings including prefixes, and overwrite the ones you would like to change in this child. Makes it possible to follow a request all the way down (s. below `requestId`)
- **Runtime settings changes:** Use `setSettings()` to change settings during runtime. Changes will also propagate to every potential child logger but can also be overwritten along the way. Prefixes will be enhanced instead of overwritten.
- **requestId:** Use `async_hooks` (e.g. `AsyncLocalStorage`) to follow a request all the way down the promise chain (Example: Display all logs from Server down to DB)
- **Mask secrets:** Use `maskValuesOfKeys` & `maskStrings` to prevent _tslog_ from printing secrets and sensitive information like passwords, secrets, api keys and Authorization Bearer
- **Prefix:** `prefix` Prefix every log message with additional attributes that are also inherited to child loggers
- **Types:** `displayTypes: true` Display types for all variables passed to _tslog_, eg. `string: test number: 123`

## 2.2.0:

Fri, 05 Jun 2020
Added additional output settings:

- dateTimePattern: DateTime pattern based on Intl.DateTimeFormat.formatToParts with additional milliseconds, default: `year-month-day hour:minute:second.millisecond`
- dateTimeTimezone: DateTime timezone, e.g. `utc`, or `Europe/Berlin`, `Europe/Moscow`. You can use `Intl.DateTimeFormat().resolvedOptions().timeZone` for local timezone, default: "utc"
- printLogMessageInNewLine: Print log message in a new line below meta information, default: `false`
- displayDateTime: Display date time at the beginning of a log message, default: `true`
- displayLogLevel: Display log level, default: `true`
- displayInstanceName: Display instanceName or not, default: `false`
- displayLoggerName: Display name of the logger. Will only be visible if `name` was set, default: `true`
- displayFilePath: Display file path ("hidden" | "displayAll" | "hideNodeModulesOnly"), default "hideNodeModulesOnly"
- displayFunctionName: Display function name, default: `true`

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

_Initial release_
