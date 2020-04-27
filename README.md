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
- ⚡ Small footprint, blazing performance
- 👮‍️ Fully typed with TypeScript support (correct location in *.ts files)
- 🧮 Log levels
- 🗃 Structured or `JSON` output
- 🦸 Custom pluggable loggers
- 💅 Object and error interpolation
- 🕵️‍ Error code frame
- 🤓 Stack trace through native V8 API
- 👨‍💻 Code position linked to IDE
- 🏗 Works for both: TypeScript and JavaScript
- 🧲 Optionally catch all `console` logs
- ✍ well documented
- 😎 100% test coverage

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

*Enable TypeScript source map support*

>This features enables `tslog` to reference to the correct line numbers in your TypeScript source code. 

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

* *Log level:* `silly`, `trace`, `debug`, `info`, `warn`, `error`, `fatal` (different colors)
* *Output to std:* Structured/_pretty_ (easy parsable `tab` delimiters), `JSON` or suppressed
* *Attachable transports:* Send logs to an external log aggregation services, file system, database or email/slack/sms/you name it...
* *Correct std per log level:* `stdout` for `silly`, `trace`, `debug`, `info` and `stderr` for `warn`, `error`, `fatal` 
* *Minimum log level per output:* Min log level can be set individually per transport
* *Fully typed:* Written in TypeScript, fully typed, API checked with <a href="https://api-extractor.com" target="_blank">`api-extractor`</a>, _TSDoc_ documented .
* *Source maps lookup:* Shows exact position also in TypeScript code (compile-to-JS ), one click to IDE position. 
* *Stack trace:* Callsites from the <a href="https://v8.dev/docs/stack-trace-api" target="_blank">V8 stack trace API</a> 
* *Pretty Error:* Errors and stack traces printed in a structured way and fully accessible through _JSON_ (e.g. external Log services)  
* *Stack frame:* tslog captures and displays the source code that lead to an error, making it easier to debug.
* *Object/JSON highlighting:* Nicely printed out objects. 
* *Instance Name:* Logs capture instance name (default hos name) making it easy to distinguish logs coming from different instances (e.g. serverless). 
* *Named Logger:* Logger can be named (e.g. useful for packages/modules and monorepos)
* *Highly configurable:* All settings can be changed through a typed settings object
* *Short paths:* Paths are relative to the root of the application folder
* *Tested:* 100% Code coverage, CI

### API documentation:  [TSDoc](https://fullstack-build.github.io/tslog/tsdoc/)
