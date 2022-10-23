## 📝 tslog: Beautiful logging experience for TypeScript and JavaScript

[![lang: Typescript](https://img.shields.io/badge/Language-Typescript-Blue.svg?style=flat-square)](https://www.typescriptlang.org)
![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
[![npm version](https://img.shields.io/npm/v/tslog?color=76c800&logoColor=76c800&style=flat-square)](https://www.npmjs.com/package/tslog)
![CI: GitHub](https://github.com/fullstack-build/tslog/actions/workflows/ci.yml/badge.svg)
[![codecov.io](https://codecov.io/github/fullstack-build/tslog/coverage.svg?branch=v4)](https://codecov.io/github/fullstack-build/tslog?branch=master)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![GitHub stars](https://img.shields.io/github/stars/fullstack-build/tslog.svg?style=social&label=Star)](https://github.com/fullstack-build/tslog)

> Powerful, fast and expressive logging for TypeScript and JavaScript
 
![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog.png "tslog pretty output in browser and Node.js")


### Highlights

⚡ **fast and powerful**<br>
🪶 **Lightweight and flexible**<br>
👮‍️ **Fully typed with TypeScript support (native source maps)**<br>
🗃 **_Pretty_ or `{} JSON` output**<br>
📝 **Customizable log level**
🏗 **Works in Browsers and Node.js**<br>
⭕️ **Supports _circular_ structures**<br>
🦸 **Custom pluggable loggers**<br>
💅 **Object and error interpolation**<br>
🤓 **Stack trace and pretty errors**<br>
👨‍👧‍👦 **Sub logger with inheritance**<br>
🙊 **Mask/hide secrets and keys**<br>
📦 **ESM with tree shaking support**<br>
✍️ **well documented and tested**<br>

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
    target: "es2020",
  },
}
```

And run with:

Node.js with JavaScript:
```bash
node --enable-source-maps
```

Node.js with TypeScript (with ESM support):
```bash
node --enable-source-maps --experimental-specifier-resolution=node --no-warnings --loader ts-node/esm
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

- **Isomorphic:** Works in browsers and Node.js
- **Tested:** 100% code coverage, CI
- **Super customizable** Every aspect can be overwritten
- **Fully typed:** Written in TypeScript, fully typed, <a href="https://github.com/microsoft/tsdoc" target="_blank">_TSDoc_</a> documented with native TypeScript support
- **Default log level:** `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` (different colors)
- **Customizable log level:** BaseLogger with configurable log level
- **Pretty & JSON output:** Structured/_pretty_, `JSON` or suppressed output
- **Attachable transports:** Send logs to an external log aggregation services, file system, database, or email/slack/sms/you name it...
- **Minimum log level per output:** `minLevel` level can be set individually per transport
- **Native source maps lookup:** Shows exact position also in TypeScript code (compile-to-JS), one click to IDE position
- **Pretty Error:** Errors and stack traces printed in a structured way and fully accessible through _JSON_ (e.g. external Log services)
- **ES Modules** import syntax with ([tree-shaking](https://webpack.js.org/guides/tree-shaking/))
- **Object/JSON highlighting:** Nicely prints out an object using native Node.js `utils.inspect` method
- **Sub Logger with inheritance** Powerful sub loggers with settings inheritance, also at runtime
- **Secrets masking:** Prevent passwords and secrets from sneaking into log files by masking them
- **Short paths:** Paths are relative to the root of the application folder
- **Prefixes:** Prefix log messages and bequeath prefixes to child loggers

### API documentation

#### [📘 TSDoc](https://fullstack-build.github.io/tslog/tsdoc/)

#### <a name="life_cycle"></a>Lifecycle of a log message

Every incoming log message runs through a number of steps before being displayed or handed over to a "transport". Every steps can be overwritten and adjusted.  

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_lifecycle.png "tslog: life cycle of a log message")

- **log message** Log message comes in through the BaseLogger.log() method
- **mask** If masking is configured the log message gets recursively masked
- **toLogObj** Log message gets transformed into a log object: A default typed log object can be passed to constructor as a second parameter and will be cloned and enriched with the incoming log parameters. Error properties will be handled accordingly. If there is only one log property, and it's an object, both objects (cloned default `logObj` as well as the log property object will be merged.) Are there more than one, they will be pu into properties called "0", "1", ... and so on. Alternatively, log message properties can be put into a property with a name configured with the `argumentsArrayName` setting.  
- **addMetaToLogObj** Additional meta information, like the source code position of the log will be gathered and added to the `_meta` property or any other one configured with the setting `metaProperty`.
- **format** In case of "pretty" configuration, a log object will be formatted based on the templates configured in settings. Meta will be formatted by the method `_prettyFormatLogObjMeta` and the actual log payload will be formatted by `prettyFormatLogObj`. Both steps can be overwritten with the settings `formatMeta` and `formatMeta`. 
- **transport** Last step is to "transport" a log message to every attached transport from the setting `attachedTransports`. Last step is the actual transport, either JSON (`transportJSON`), formatted (`transportFormatted`) or omitted, if its set to "hidden". Both default transports can also be overwritten by the corresponding setting.  

#### Defining the `logObj`
As described in "Lifecycle of a log message", every log message goes through some lifecycle steps and becomes an object representation with the name `logObj`. 
In comparison to `tslog` < 4 this object becomes highly configurable, can contain any property, and can be adjusted to any scenario and 3rd party integration. There are now almost endless opportunities.

```typescript

interface ILogObj {
    foo: string;
}

const defaultLogObject: ILogObj = {
  foo: "bar",
};

const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
const logMsg = logger.info("Test"); 

// logMsg: {}

```

#### Accessing the `logObj`


```typescript
import { Logger, ILogObject } from "tslog";

const log: Logger = new Logger();

const logWithTrace: ILogObject = log.trace(
  "I am a trace log with a stack trace."
);

console.log(JSON.stringify(logWithTrace, null, 2));
```
