## 📝 tslog: Beautiful logging experience for Node.js with TypeScript support

[![lang: Typescript](https://img.shields.io/badge/Language-Typescript-Blue.svg?style=flat-square)](https://www.typescriptlang.org)
![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
[![npm version](https://img.shields.io/npm/v/tslog?color=76c800&logoColor=76c800&style=flat-square)](https://www.npmjs.com/package/tslog)
[![CI: Travis](https://img.shields.io/travis/fullstack-build/tslog?style=flat-square)](https://travis-ci.com/github/fullstack-build/tslog)
[![Coverage Status](https://img.shields.io/coveralls/github/fullstack-build/tslog?style=flat-square)](https://coveralls.io/github/fullstack-build/tslog)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![GitHub stars](https://img.shields.io/github/stars/fullstack-build/tslog.svg?style=social&label=Star)](https://github.com/fullstack-build/tslog)

> Powerful, fast and expressive logging for Node.js

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_pretty_output.png "tslog pretty output")

### Highlights

⚡ **Batteries included, native V8 integration**<br>
👮‍️ **Fully typed with TypeScript support (exact code position)**<br>
🗃 **_Pretty_ or `JSON` output**<br>
⭕️ **Supports _circular_ structures**<br>
🦸 **Custom pluggable loggers**<br>
💅 **Object and error interpolation**<br>
🕵️‍ **Code surrounding error position (_code frame_)**<br>
🤓 **Stack trace through native V8 API**<br>
🏗 **Works for TypeScript and JavaScript**<br>
👨‍👧‍👦 **Child logger with inheritance**<br>
🙊 **Mask/hide secrets and keys**<br>
🔍 **Native support for request IDs (<a href="https://nodejs.org/api/async_hooks.html#async_hooks_async_hooks" target="_blank">`async_hooks`</a>, <a href="https://nodejs.org/api/async_hooks.html#async_hooks_class_asynclocalstorage" target="_blank">`AsyncLocalStorage`</a>)**<br>
📦 **CommonJS and ES Modules with tree shaking support**<br>
🧲 **Optionally catch all `console` logs**<br>
✍️ **well documented**<br>

### Example

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger();
log.silly("I am a silly log.");
```

### Install

```bash
npm install tslog
```

**Enable TypeScript source map support:**

This feature enables `tslog` to reference a correct line number in your TypeScript source code.

```json5
// tsconfig.json
{
  // ...
  compilerOptions: {
    // ...
    sourceMap: true,
    // we recommend using a current ES version
    target: "es2019",
  },
}
```

### Simple example

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
log.trace("I am a trace log with a stack trace.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", { foo: "bar" });
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```

### All Features

- **Log level:** `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` (different colors)
- **Output to std:** Structured/_pretty_ output (easy parsable `tab` delimiters), `JSON` or suppressed
- **Attachable transports:** Send logs to an external log aggregation services, file system, database, or email/slack/sms/you name it...
- **StdOut or StdErr depends on log level:** **_stdout_** for `silly`, `trace`, `debug`, `info` and **_stderr_** for `warn`, `error`, `fatal`
- **Minimum log level per output:** `minLevel` level can be set individually per transport
- **Fully typed:** Written in TypeScript, fully typed, API checked with <a href="https://api-extractor.com" target="_blank">_api-extractor_</a>, <a href="https://github.com/microsoft/tsdoc" target="_blank">_TSDoc_</a> documented
- **Source maps lookup:** Shows exact position also in TypeScript code (compile-to-JS), one click to IDE position
- **Stack trace:** Callsites through native <a href="https://v8.dev/docs/stack-trace-api" target="_blank">_V8 stack trace API_</a>, excludes internal entries
- **CommonJS and ES Modules**<br>
- **Tree shake support** via ESM import syntax ([tree-shaking](https://webpack.js.org/guides/tree-shaking/))
- **Pretty Error:** Errors and stack traces printed in a structured way and fully accessible through _JSON_ (e.g. external Log services)
- **Code frame:** `tslog` captures and displays the source code that lead to an error, making it easier to debug
- **Object/JSON highlighting:** Nicely prints out an object using native Node.js `utils.inspect` method
- **Instance Name:** Logs capture instance name (default host name) making it easy to distinguish logs coming from different instances (e.g. serverless)
- **Named Logger:** Logger can be named (e.g. useful for packages/modules and monorepos)
- **Highly configurable:** All settings can be changed through a typed object, also during run time (e.g. log level)
- **Adjust settings at runtime** Change settings at runtime with immediate impact (e.g. log level)
- **Child Logger with inheritance** Powerful child loggers with settings inheritance, also at runtime
- **RequestId:** Group logs originated from a request and follow them all the way down the promise chain
- **Secrets masking:** Prevent passwords and secrets from sneaking into log files by masking them
- **Short paths:** Paths are relative to the root of the application folder
- **Prefixes:** Prefix log messages and bequeath prefixes to child loggers
- **Types:** Display type information
- **Runtime-agnostic:** Works with `ts-node`, `ts-node-dev`, as well as compiled down to JavaScript
- **Optionally overwrite `console`:** Catch `console.log` etc. that would otherwise be hard to find
- **Tested:** 100% code coverage, CI

### API documentation

#### [📘 TSDoc](https://fullstack-build.github.io/tslog/tsdoc/)

#### <a name="logObject"></a>Log object

<a href="https://tslog.js.org/tsdoc/interfaces/ilogobject.html" target="_blank">TSDoc: `interface: ILogObject`</a>

Internally `tslog` creates an object representing every available information around a particular log message, including errors, stack trace etc.
This information can become quite handy in case you want to work with this data or forward it to an external log service.

```typescript
interface ILogObject {
  /**  Optional name of the instance this application is running on. */
  instanceName?: string;
  /**  Optional name of the logger or empty string. */
  loggerName?: string;
  /* Name of the host */
  hostname: string;
  /** Optional unique request ID */
  requestId?: string;
  /**  Timestamp */
  date: Date;
  /**  Log level name (e.g. debug) */
  logLevel: silly | trace | debug | info | warn | error | fatal;
  /**  Log level ID (e.g. 3) */
  logLevelId: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /**  Log arguments */
  argumentsArray: (
    | unknown
    | {
        /** Is this object an error? */
        isError: true;
        /** Name of the error*/
        name: string;
        /** Error message */
        message: string;
        /** additional Error details */
        details: object;
        /** native Error object */
        nativeError: Error;
        /** Stack trace of the error */
        stack: IStackFrame[];
        /** Code frame of the error */
        codeFrame?: {
          firstLineNumber: number;
          lineNumber: number;
          columnNumber: number | null;
          linesBefore: string[];
          relevantLine: string;
          linesAfter: string[];
        };
      }
  )[];
  /**  Optional Log stack trace */
  stack?: {
    /** Relative path based on the main folder */
    filePath: string;
    /** Full path */
    fullFilePath: string;
    /** Name of the file */
    fileName: string;
    /** Line number */
    lineNumber: number | null;
    /** Column Name */
    columnNumber: number | null;
    /** Called from constructor */
    isConstructor: boolean | null;
    /** Name of the function */
    functionName: string | null;
    /** Name of the class */
    typeName: string | null;
    /** Name of the Method */
    methodName: string | null;
  }[];
}
```

There are three ways to access this object:

##### Returned by each log method

```typescript
import { Logger, ILogObject } from "tslog";

const log: Logger = new Logger();

const logWithTrace: ILogObject = log.trace(
  "I am a trace log with a stack trace."
);

console.log(JSON.stringify(logWithTrace, null, 2));
```

##### Printed out in _JSON_ mode

```typescript
new Logger({ type: "json" });
```

Resulting in the following output:
![tslog log level json](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_json.png)

##### Forwarded to an attached transport

<a href="#/?id=transports">More details below</a>

#### Log level

`tslog` is highly customizable, however, it follows _convention over configuration_ when it comes to **log levels**.
Internally a log level is represented by a numeric ID.

Available log levels are:<br>
`0: silly`, `1: trace`, `2: debug`, `3: info`, `4: warn`, `5: error`, `6: fatal`

Per default log level 0 - 3 are written to `stdout` and 4 - 6 are written to `stderr`.
Each log level is printed in a different color, that is customizable through the settings object.

> **Hint:** Log level `trace` behaves a bit differently compared to all the other log levels.
> While it is possible to activate a stack trace for every log level, it is already activated for `trace` by default.
> That means every `trace` log will also automatically capture and print its entire stack trace.

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger();
log.silly("I am a silly log.");
log.trace("I am a trace log with a stack trace.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", { foo: "bar" });
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```

Structured (aka. _pretty_) log level output would look like this:
![tslog log level structured](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_pretty.png "tslog log level structured")

> **Hint:** Each logging method has a return type, which is a _JSON_ representation of the log message (`ILogObject`).
> You can use this object to access its stack trace etc.
> <a href="#logObject">More details</a>

#### Child Logger

Each `tslog` Logger instance can create child loggers and bequeath its settings to a child.
It is also possible to overwrite every setting when creating a child.<br>
Child loggers are a powerful feature when building a modular application and due to its inheritance make it easy to configure the entire application.

Use `getChildLogger()` to create a child logger based on the current instance.

**Example:**

```typescript
const logger: Logger = new Logger({ name: "MainLogger" });

const childLogger: Logger = logger.getChildLogger({ name: "FirstChild" });

const grandchildLogger: Logger = childLogger.getChildLogger({
  name: "GrandChild",
});
```

#### Creating logger without source map support

By default, `Logger` creates instance with stack trace's source mapping support. For some cases, it may not be needed. `LoggerWithoutCallSite` returns same interface as `Logger` does and only disabling call site wrapping for source map.

```typescript
import { Logger, LoggerWithoutCallSite } from 'tslog';

const logger = new Logger(...);
const loggerWithoutCallSite = new LoggerWithoutCallSite(...);

```

Since `tslog` supports [tree-shaking](https://webpack.js.org/guides/tree-shaking/) via esm import syntax, importing `LoggerWithoutCallSite` without `Logger` will reduce overall bundle size.

#### Settings

As `tslog` follows _convention over configuration_, it already comes with reasonable default settings.
Therefor all settings are optional. Nevertheless, they can be flexibly adapted to your own needs.

All possible settings are defined in the `ISettingsParam` interface and modern IDEs will provide auto-completion accordingly.

**You can use `setSettings()` to adjust settings at runtime.**

> **Hint:** When changing settings at runtime this alternation would also propagate to every child loggers, as long as it has not been overwritten down the hierarchy.

##### `type`

`default: "pretty"`

Possible values: `"json" | "pretty" | "hidden"`

You can either `pretty` print logs, print them as `json` or hide them all together with `hidden` (e.g. when using custom transports).<br>
Having `json` as an output format is particularly useful, if you want to forward your logs directly from your `std` to another log service.
Instead of parsing a _pretty_ output, most log services prefer a _JSON_ representation.

> **Hint:** Printing in `json` gives you direct access to all the available information, like _stack trace_ and _code frame_ and so on.

```typescript
new Logger({ type: "json" });
```

_Output:_
![tslog log level json](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_json.png)

> **Hint:** Each _JSON_ log is printed in one line, making it easily parsable by external services.

##### `instanceName`

`default: os.hostname` _(hidden by default)_

You can provide each logger with the name of the instance, making it easy to distinguish logs from different machines.
This approach works well in the serverless environment as well, allowing you to filter all logs coming from a certain instance.

Per default `instanceName` is pre-filled with the `hostname` of your environment, which can be overwritten.
However, this value is hidden by default in order to keep the log clean and tidy.
You can change this behavior by setting `displayInstanceName` to `true`.

```typescript
const logger: Logger = new Logger({ displayInstanceName: true });
// Would print out the host name of your machine

const logger: Logger = new Logger({
  displayInstanceName: true,
  instanceName: "ABC",
});
// Would print out ABC as the name of this instance
```

##### `name`

`default: undefined`

Each logger has an optional name, that is hidden by default. You can change this behavior by setting `displayLoggerName` to `true`.
This setting is particularly interesting when working in a `monorepo`,
giving you the possibility to provide each module/package with its own logger and being able to distinguish logs coming from different parts of your application.

```typescript
new Logger({ name: "myLogger" });
```

_Additional Setting:_

`setCallerAsLoggerName: false`

When setting to `true` `tslog` will use caller name as the default name of the logger.

```typescript
new Logger({ setCallerAsLoggerName: true });
```

##### `minLevel`

`default: "silly"`

Minimum log level to be captured by this logger.
Possible values are: `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal`

##### `requestId`

`default: undefined`

**❗ Keep track of all subsequent calls and promises originated from a single request (e.g. HTTP).**

In a real world application a call to an API would lead to many logs produced across the entire application.
When debugging it can get quite handy to be able to group all logs based by a unique identifier `requestId`.

A `requestId` can either be a `string` or a function.<br>
A string is suitable when you create a child logger for each request, while a function is helpful, when you need to reuse the same logger and need to obtain a `requistId` dynamically.

**With Node.js 13.10, we got a new feature called <a href="https://nodejs.org/api/async_hooks.html#async_hooks_class_asynclocalstorage" target="_blank">AsyncLocalStorage.</a>**<br>
It has also been backported to Node.js v12.17.0 and of course it works with Node.js >= 14.<br>
However it is still marked as _experimental_. <br>
Here is <a href="https://itnext.io/one-node-js-cls-api-to-rule-them-all-1670ac66a9e8" target="_blank">a blog post by Andrey Pechkurov</a> describing `AsyncLocalStorage` and performing a small performance comparison.

> **Hint**: If you prefer to use a more proven (yet slower) approach, you may want to check out <a href="https://www.npmjs.com/package/cls-hooked" target="_blank">`cls-hooked`</a>.

Even though `tslog` is generic enough and works with any of these solutions our example is based on `AsyncLocalStorage`.<br>
`tslog` also works with any API framework (like `Express`, `Koa`, `Hapi` and so on), but we are going to use `Koa` in this example.<br>
Based on this example it should be rather easy to create an `Express` or another middleware.

Some provides (e.g. `Heroku`) already set a `X-Request-ID` header, which we are going to use or fallback to a short ID generated by <a href="https://www.npmjs.com/package/nanoid" target="_blank">`nanoid`</a>.

**In this example every subsequent logger is a child logger of the main logger and thus inherits all of its settings making `requestId` available throughout the entire application without any further ado.**

_index.ts:_

```typescript
import * as Koa from "koa";
import { AsyncLocalStorage } from "async_hooks";
import { customAlphabet } from "nanoid";

const asyncLocalStorage: AsyncLocalStorage<{ requestId: string }> =
  new AsyncLocalStorage();

const logger: Logger = new Logger({
  name: "Server",
  requestId: (): string => {
    return asyncLocalStorage.getStore()?.requestId as string;
  },
});
export { logger };

const app: Koa = new Koa();

/** START AsyncLocalStorage requestId middleware **/
koaApp.use(async (ctx: Koa.Context, next: Koa.Next) => {
  // use x-request-id or fallback to a nanoid
  const requestId: string =
    ctx.request.headers["x-request-id"] ||
    customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 6)();
  // every other Koa middleware will run within the AsyncLocalStorage context
  await asyncLocalStorage.run({ requestId }, async () => {
    return next();
  });
});
/** END AsyncLocalStorage requestId middleware **/
```

_other_file.ts:_

```typescript
import { logger } from "./index";

const childLogger = logger.getChildLogger({ name: "ChildLogger" });

childLogger.info("Log containing requestId"); // <-- will contain a requestId
```

##### `exposeStack`

`default: false`

Usually, only _Errors_ and log level `trace` logs would capture the entire stack trace.
By enabling this option **every** stack trace of every log message is going to be captured.

```typescript
new Logger({ exposeStack: true });
```

![tslog with a stack trace](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_stacktrace.png)

> **Hint:** When working in an IDE like _WebStorm_ or an editor like _VSCode_ you can click on the path leading you directly to the position in your source code.

##### `exposeErrorCodeFrame`

`default: true`

A nice feature of `tslog` is to capture the _code frame_ around the error caught, showing the _exact_ location of the error.
While it comes quite handy during development, it also means that the source file (_.js or _.ts) needs to be loaded.
When running in production, you probably want as much performance as possible and since errors are analyzed at a later point in time,
you may want to disable this feature.
In order to keep the output clean and tidy, code frame does not follow into `node_modules`.

```typescript
new Logger({ exposeErrorCodeFrame: false });
```

> **Hint:** By default 5 lines before and after the line with the error will be displayed.
> You can adjust this setting with `exposeErrorCodeFrameLinesBeforeAndAfter`.

![tslog with a code frame](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_code_frame.png)

##### `ignoreStackLevels`

`default: 3`

Defines how many stack levels should be ignored.
`tslog` adds additional 3 layers to the stack and that the reason why the default is set to `3`.
You can increase this number, if you want to add additional layers (e.g. a factory class or a facade).

##### `suppressStdOutput`

`default: false`

It is possible to connect multiple _transports_ (external loggers) to `tslog` (see below).
In this case it might be useful to suppress all output.

```typescript
new Logger({ suppressStdOutput: true });
```

##### `overwriteConsole`

`default: false`

`tslog` is designed to be used directly through its API.
However, there might be use cases, where you want to make sure to capture all logs,
even though they might occur in a library or somebody else's code.
Or maybe you prefer or used to work with `console`, like `console.log`, `console.warn` and so on.

In this case, you can advise `tslog` to overwrite the default behavior of `console`.

> **Hint:** It is only possible to overwrite `console` once, so the last attempt wins.
> If you wish to do so, I would recommend to have a designated logger for this purpose.

```typescript
new Logger({ name: "console", overwriteConsole: true });
```

`tslog` applies the following mapping:

- `console.log`: `silly`
- `console.trace`: `trace`
- `console.info`: `info`
- `console.warn`: `warn`
- `console.error`: `error`

_There is no `console.fatal`._

##### `colorizePrettyLogs`

`default: true`

By default `pretty` output is colorized with ANSI escape codes. If you prefer a plain output, you can disable the colorization with this setting.

##### `logLevelsColors`

This setting allows you to overwrite the default log level colors of `tslog`.

Possible styles are:

- <a href="https://nodejs.org/api/util.html#util_foreground_colors" target="_blank">Foreground colors</a>
- <a href="https://nodejs.org/api/util.html#util_background_colors" target="_blank">Background colors</a>
- <a href="https://nodejs.org/api/util.html#util_modifiers" target="_blank">Modifiers</a>

##### `prettyInspectHighlightStyles`

This setting allows you to overwrite the default colors of `tslog` used for the native Node.js `utils.inspect` interpolation.

More Details: <a href="https://nodejs.org/api/util.html#util_customizing_util_inspect_colors" target="_blank">Customizing util.inspect colors</a>

##### `delimiter`

`default: [ ] (space)`
Set a custom pretty log delimiter.

##### `dateTimePattern`

`default: "year-month-day hour:minute:second.millisecond"`

> **Caution!** Changing this pattern will affect performance (invocation of Intl.DateTimeFormat)

Change the way `tslog` prints out the date.
Based on Intl.DateTimeFormat formatToParts with additional milliseconds, you can use type as a placeholder.
Available placeholders are: `day`, `dayPeriod`, `era`, `hour`, `literal`, `minute`, `month`, `second`, `millisecond`, `timeZoneName`, `weekday` and `year`.

##### `dateTimeTimezone`

`default: "utc" `

Define in which timezone the date should be printed in.
Possible values are `utc` and <a href="https://www.iana.org/time-zones" target="_blank">IANA (Internet Assigned Numbers Authority)</a> based timezones, e.g. `Europe/Berlin`, `Europe/Moscow` and so on.

> **Hint:** If you want to use your local time zone, you can set:
> `dateTimeTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone`

> **Caution!** Changing this pattern will affect performance (invocation of Intl.DateTimeFormat)

##### `prefix`

`default: [] `

Prefix every log message with an array of additional attributes.<br>
Prefixes propagate to child loggers and can help to follow a chain of promises.<br>
In addition to `requestId`, prefixes can help further distinguish different parts of a request.

> **Hint:** A good example could be a GraphQL request, that by design could consist of multiple queries and/or mutations.<br>
> A `requestId` would mark all the operations and prefixes can help to distinguish separate queries/mutations inside of this request.

**Example:**

```typescript
const logger: Logger = new Logger({
  name: "MainLogger",
  prefix: ["main", "parent"],
});
logger.info("MainLogger message");
// Output:
// INFO   [MainLogger]   main  parent  MainLogger message

const childLogger: Logger = logger.getChildLogger({
  name: "FirstChild",
  prefix: ["child1"],
});
childLogger.info("child1 message");
// Output:
// INFO   [FirstChild]   main  parent  child1  child1 message

const grandchildLogger: Logger = childLogger.getChildLogger({
  name: "GrandChild",
  prefix: ["grandchild1"],
});
grandchildLogger.silly("grandchild1 message");
// Output:
// INFO   [GrandChild]   main  parent  child1  grandchild1 grandchild1 message

// change settings during runtime
childLogger.setSettings({ prefix: ["renamedChild1"] });
grandchildLogger.silly("grandchild1 second message");
// Output:
// INFO   [GrandChild]   main  parent  renamedChild1     grandchild1 second message
```

##### `maskValuesOfKeys`

`default: ["password"] `

One of the most common ways of a password/secrets breach is through log files.
Given the central position of `tslog` as the collecting hub of all application logs, it's only natural to use it as a filter.
`maskValuesOfKeys` makes it possible to hide/mask all values of fields from objects passed into `tslog`.

**`maskValuesOfKeys` is case insensitive!**

```typescript
const secretiveLogger = new Logger({
  name: "SecretiveLogger",
  maskValuesOfKeys: ["test", "authorization", "password"],
});

let secretiveObject = {
  Authorization: 1234567,
  regularString: "I am just a regular string.",
  user: {
    name: "Test",
    otherString: "Test123.567",
    password: "swordfish",
  },
};

secretiveLogger.info(secretiveObject);

// Output:
// INFO   [SecretiveLogger]
// {
//   Authorization: '[***]',
//   regularString: 'I am just a regular string.',
//   user: {
//     name: "Test",
//     otherString: "Test123.567",
//     password: '[***]',
//   }
// }
```

##### `maskAnyRegEx`

`default: [] `

When `maskValuesOfKeys` is just not enough, and you really want to make sure no secrets get populated, you can also use `maskAnyRegEx` to mask every occurrence of a string matching a particular RegEx.

> **Hint:** It will also mask keys if it encounters a matching pattern.

**`maskValuesOfKeys` is case sensitive!**

```typescript
const verySecretiveLogger = new Logger({
  name: "SecretiveLogger",
  maskValuesOfKeys: ["test", "authorization", "password"],
  maskAnyRegEx: ["pass.*"], // mask every string that starts with "pass"
});

let secretiveObject = {
  Authorization: 1234567,
  regularString: "I am just a regular string.",
  user: {
    name: "Test",
    otherString: "pass1234.567",
    password: "swordfish",
  },
};

verySecretiveLogger.info(secretiveObject);

// Output:
// INFO   [SecretiveLogger]
// {
//   Authorization: '[***]',
//   regularString: 'I am just a regular string.',
//   user: {
//     name: "Test",
//     otherString: "[***].567",
//     password: '[***]',
//   }
// }
```

> **Hint:** useful for API keys and other secrets (e.g. from ENVs).

##### `maskPlaceholder`

`default: "[***]" `

String to use for masking of secrets (s. `maskAnyRegEx` & `maskValuesOfKeys`)

##### `printLogMessageInNewLine`

`default: false `

By default `tslog` uses `tab` delimiters for separation of the meta information (date, log level, etc.) and the log parameters.
Since the meta information can become quite long, you may want to prefer to print the log attributes in a new line.

##### `displayDateTime`

`default: true `

Defines whether the date time should be displayed.

##### `displayLogLevel`

`default: true `

Defines whether the log level should be displayed.

##### `displayInstanceName`

`default: false `

Defines whether the instance name (e.g. host name) should be displayed.

##### `displayLoggerName`

`default: true `

Defines whether the optional logger name should be displayed.

##### `displayRequestId`

`default: true `

Defines whether the `requestId` should be displayed, if set and available (s. `requestId`).

##### `displayFunctionName`

`default: true `

Defines whether the class and method or function name should be displayed.

##### `displayTypes`

`default: false `

Defines whether type information (`typeof`) of every attribute passed to `tslog` should be displayed.

##### `displayFilePath`

`default: hideNodeModulesOnly `

Defines whether file path and line should be displayed or not.
There are 3 possible settgins:

- `hidden`
- `displayAll`
- `hideNodeModulesOnly` (default): This setting will hide all file paths containing `node_modules`.

##### `stdOut` and `stdErr`

This both settings allow you to replace the default `stdOut` and `stdErr` _WriteStreams_.
However, this would lead to a colorized output. We use this setting mostly for testing purposes.
If you want to redirect the output or directly access any logged object, we advise you to **attach a transport** (see below).

#### <a name="transport"></a>Transports

`tslog` focuses on the one thing it does well: capturing logs.
Therefore, there is no build-in _file system_ logging, _log rotation_, or similar.
Per default all logs go to `stdOut` and `stdErr` respectively.

However, you can easily attach as many _transports_ as you wish, enabling you to do fancy stuff
like sending a message to _Slack_ or _Telegram_ in case of an urgent error.

When attaching a transport, you _must_ implement every log level.
All of them could be potentially handled by the same function, though.

Each _transport_ can have its own `minLevel`.

**Attached transports are also inherited to child loggers.**

##### Simple transport example

Here is a very simple implementation used in our _jest_ tests:

```typescript
import { ILogObject, Logger } from "tslog";

const transportLogs: ILogObject[] = [];

function logToTransport(logObject: ILogObject) {
  transportLogs.push(logObject);
}

const logger: Logger = new Logger();

logger.attachTransport(
  {
    silly: logToTransport,
    debug: logToTransport,
    trace: logToTransport,
    info: logToTransport,
    warn: logToTransport,
    error: logToTransport,
    fatal: logToTransport,
  },
  "debug"
);
```

##### Storing logs in a file

Here is an example how to store all logs in a file.

```typescript
import { ILogObject, Logger } from "tslog";
import { appendFileSync } from "fs";

function logToTransport(logObject: ILogObject) {
  appendFileSync("logs.txt", JSON.stringify(logObject) + "\n");
}

const logger: Logger = new Logger();
logger.attachTransport(
  {
    silly: logToTransport,
    debug: logToTransport,
    trace: logToTransport,
    info: logToTransport,
    warn: logToTransport,
    error: logToTransport,
    fatal: logToTransport,
  },
  "debug"
);

logger.debug("I am a debug log.");
logger.info("I am an info log.");
logger.warn("I am a warn log with a json object:", { foo: "bar" });
```

**Result:** `logs.txt`

```json
{"loggerName":"","date":"2020-04-27T15:24:04.334Z","logLevel":"debug","logLevelId":2,"filePath":"example/index.ts","fullFilePath":"/Users/eugene/Development/workspace/tslog/example/index.ts","fileName":"index.ts","lineNumber":56,"columnNumber":5,"isConstructor":false,"functionName":null,"typeName":"Object","methodName":null,"argumentsArray":["I am a debug log."]}
{"loggerName":"","date":"2020-04-27T15:24:04.334Z","logLevel":"info","logLevelId":3,"filePath":"example/index.ts","fullFilePath":"/Users/eugene/Development/workspace/tslog/example/index.ts","fileName":"index.ts","lineNumber":57,"columnNumber":5,"isConstructor":false,"functionName":null,"typeName":"Object","methodName":null,"argumentsArray":["I am an info log."]}
```

#### Helper

##### prettyError

Sometimes you just want to _pretty print_ an error without having to log it, or maybe just catch its call sites, or it's stack frame? If so, this helper is for you.
`prettyError` exposes all the awesomeness of `tslog` without the actual logging. A possible use case could be in a CLI, or other internal helper tools.

Example:

```typescript
const logger: Logger = new Logger();
const err: Error = new Error("Test Error");
logger.prettyError(err);
```

_Additional Parameters:_

- `error` - Error object
- `print` - Print the error or return only? _(default: true)_
- `exposeErrorCodeFrame` - Should the code frame be exposed? _(default: true)_
- `exposeStackTrace` - Should the stack trace be exposed? _(default: true)_
- `stackOffset` - Offset lines of the stack trace _(default: 0)_
- `stackLimit` - Limit number of lines of the stack trace _(default: Infinity)_
- `std` - Which std should the output be printed to? _(default: stdErr)_

##### printPrettyLog

If you just want to _pretty print_ an error on a custom output (for adding a new transport for example),
you can just call `logger.printPrettyLog(myStd, myLogObject)` where myStd is an instance of `IStd` (e.g. `process.stdout`, `process.stderr` or even a custom one, see example below):

```typescript
class SimpleStd implements IStd {
  constructor(private _buffer: string = "") {}
  write(message: string) {
    this._buffer += message;
  }

  get buffer(): string {
    return this._buffer;
  }
}

const logger: Logger = new Logger();

const myStd = new SimpleStd();
const myLogObject = logger.info("Hello World");
logger.printPrettyLog(myStd, myLogObject);
```
