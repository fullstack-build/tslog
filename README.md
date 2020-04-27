## 📝 tslog: Brand new expressive TypeScript Logger for Node.js


[![lang: Typescript](https://img.shields.io/badge/Language-Typescript-Blue.svg?style=flat-square)](https://www.typescriptlang.org)
![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
[![npm version](https://img.shields.io/npm/v/tslog?color=76c800&logoColor=76c800&style=flat-square)](https://www.npmjs.com/package/tslog)
![Dependency status](https://img.shields.io/david/fullstack-build/tslog?style=flat-square)
![CI: Travis](https://img.shields.io/travis/fullstack-build/tslog?style=flat-square)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![GitHub stars](https://img.shields.io/github/stars/fullstack-build/tslog.svg?style=social&label=Star)](https://github.com/fullstack-build/tslog)

> Powerful, fast and expressive logging for Node.js 

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_pretty_output.png "tslog pretty output")

### Highlights
⚡ **Small footprint, blazing performance**<br>
👮‍️ **Fully typed with TypeScript support (correct location in \*.ts files)**<br>
🗃 **_Pretty_ or `JSON` output**<br>
🦸 **Custom pluggable loggers**<br>
💅 **Object and error interpolation**<br>
🕵️‍ **Error code frame**<br>
🤓 **Stack trace through native V8 API**<br>
🏗 **Works for both: TypeScript and JavaScript**<br>
🧲 **Optionally catch-all `console` logs**<br>
✍ **well documented**<br>
😎 **100% test coverage**<br>


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
    "compilerOptions": {
        // ...
        "sourceMap": true
    }
}
```

### Simple usage

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", {foo: "bar"});
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```

### All Features

* **Log level:** `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` (different colors)
* **Output to std:** Structured/_pretty_ (easy parsable `tab` delimiters), `JSON` or suppressed
* **Attachable transports:** Send logs to an external log aggregation services, file system, database or email/slack/sms/you name it...
* **Correct std per log level:** `stdout` for `silly`, `trace`, `debug`, `info` and `stderr` for `warn`, `error`, `fatal` 
* **Minimum log level per output:** `minLog level can be set individually per transport
* **Fully typed:** Written in TypeScript, fully typed, API checked with <a href="https://api-extractor.com" target="_blank">`api-extractor`</a>, _TSDoc_ documented .
* **Source maps lookup:** Shows exact position also in TypeScript code (compile-to-JS ), one click to IDE position. 
* **Stack trace:** Callsites from the <a href="https://v8.dev/docs/stack-trace-api" target="_blank">V8 stack trace API</a> 
* **Pretty Error:** Errors and stack traces printed in a structured way and fully accessible through _JSON_ (e.g. external Log services)  
* **Stack frame:** tslog captures and displays the source code that lead to an error, making it easier to debug.
* **Object/JSON highlighting:** Nicely printed out objects. 
* **Instance Name:** Logs capture instance name (default hos name) making it easy to distinguish logs coming from different instances (e.g. serverless). 
* **Named Logger:** Logger can be named (e.g. useful for packages/modules and monorepos)
* **Highly configurable:** All settings can be changed through a typed settings object
* **Short paths:** Paths are relative to the root of the application folder
* **Optionally overwrite `console`:** Optionally catch `console.log` etc. that would be hard to find otherwise
* **Tested:** 100% code coverage, CI

### API documentation
#### [📘 TSDoc](https://fullstack-build.github.io/tslog/tsdoc/)

#### Log level: 

`tslog` is highly customizable, however, it follows _convention over configuration_ when it comes to **log levels**. 
Internally a log level is represented by a numeric number. Supported log levels are: 
`0: silly`, `1: trace`, `2: debug`, `3: info`, `4: warn`, `5: error`, `6: fatal`

Per default log level 0 - 3 are written to `stdout` and 4 - 6 are written to `stderr`.
Each log level is printed in a different color, that is completely customizable through the settings object.

> **Hint:** Log level `trace` behaves a bit differently compared to all the other log levels. 
> While it is possible to activate a stack trace for every log level, it is already activated for `trace` by default. 
> That means, every `trace` log will also automatically capture and print its entire stack trace. 

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger();
log.silly("I am a silly log.");
log.trace("I am a trace log with a stack trace.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", {foo: "bar"});
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```

The structured (_pretty_) log level output would look like this: 


> **Hint:** Each logging method has a return type, which is a _JSON_ representation of the log message (`ILogObject`).
> You can use this object to access its stack trace etc. 
```typescript
import { Logger, ILogObject } from "tslog";

const log: Logger = new Logger();

const logWithTrace: ILogObject = log.trace("I am a trace log with a stack trace.");

console.log(JSON.stringify(logWithTrace, null, 2));
```
![tslog log level structured](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_structured.png "tslog log level structured")

#### Settings:
 
As `tslog` follows the _convention over configuration_ approach, it already comes with reasonable default settings.
Nevertheless, it can be flexibly adapted to your own needs. 

All possible settings are defined in the `ISettingsPram` interface and modern IDE will offer autocompletion accordingly.
And of course, all of them are optional and can also be combined with your needs. 

##### `instanceName` _(default: hostname)_ and `displayInstanceName` _(default: false)_:
You can provide each logger with the name of the instance, making it easy to distinguish logs from different machines.  
This approach works well in the serverless environment as well, allowing you to filter all logs coming from a certain instance. 

Per default `instanceName` is pre-filled with the `hostname` of your environment, which can be overwritten. 
However, this value is hidden by default in order to keep the log clean and tidy. 
You can change this behavior by setting `displayInstanceName` to `true`. 

```typescript

const logger: Logger = new Logger({ displayInstanceName: true });
// Would print out the host name of your machine

const logger: Logger = new Logger({ displayInstanceName: true, instanceName: "ABC" });
// Would print out ABC as the name of this instance
 
```

##### `name` _(default: "")_:

Each logger has an optional name, that is hidden by default. 
This setting is particularly interesting when working in a `monorepo`, 
giving you the chance to provide each module/package with its own logger and being able to distinguish logs coming from different parts of your application.   

```typescript
    new Logger({ name: "myLogger" });
```

##### `minLevel` _(default: "silly")_:

What should be the minimum log level that should be captured by this logger? 
Possible values are: `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal`

##### `logAsJson` _(default: false)_:
Sometimes you want to forward your logs directly from your `std` to another log service.
Instead of parsing the _pretty_ output, most log services can easily parse a _JSON_ object. 

>This gives you direct access to all the information captured by `tslog`, like _stack trace_ and _code frame_ information.
```typescript
    new Logger({ logAsJson: true });
```
Resulting in the following output: 

![tslog log level json](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_json.png)

> **Hint:** Each _JSON_ log is printed in one line, making it easily parsable by external services.

##### `exposeStack` _(default: false)_:
Usually, only _Errors_ and log level `trace` logs would capture the entire stack trace.  
By enabling this option **every** stack trace of every log message is going to be captured.

```typescript
    new Logger({ exposeStack: true });
```

![tslog with a stack trace](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_log_level_json.png)

>**Hint:** When working in an IDE like _WebStorm_ or an editor like _VSCode_ you can click on the path leading you directly to the position in your source code. 

##### `exposeErrorCodeFrame` _(default: true)_:

A nice feature of `tslog` is to capture the _code frame_ around the error caught, showing the _exact_ location of the error.   
While it comes quite handy during development, it also means that the source file (*.js or *.ts) needs to be loaded.
When running in production, you probably want as much performance as possible and since errors are analyzed at a later point in time, 
you may want to disable this feature.  

```typescript
    new Logger({ exposeErrorCodeFrame: false });
```

  /** Capture lines before and after a code frame, default: 5 */
  exposeErrorCodeFrameLinesBeforeAndAfter?: number;

  /** Suppress any log output to std out / std err */
  suppressLogging?: boolean;

  /** Catch logs going to console (e.g. console.log). Last instantiated Log instance wins */
  overwriteConsole?: boolean;

  /**  Overwrite colors of log messages of different log levels */
  logLevelsColors?: TLogLevelColor;

  /**  Overwrite colors json highlighting */
  jsonHighlightColors?: IJsonHighlightColors;

  /**  Overwrite default std out */
  stdOut?: IStd;

  /**  Overwrite default std err */
  stdErr?: IStd;
