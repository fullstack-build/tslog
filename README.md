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
- [x] Small footprint, blazing performance
- [x] Fully typed with TypeScript support (correct location in *.ts files)
- [x] Log levels
- [x] Structured or `JSON` output
- [x] Custom pluggable loggers
- [x] Object and error interpolation
- [x] Error code frame
- [x] Stack trace through native V8 API
- [x] Code position linked to IDE
- [x] Works for both: TypeScript and JavaScript
- [x] Optionally catch all `console` logs
- [x] well documented
- [x] 100% test coverage

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

### Usage

```typescript
import { Logger } from "tslog";

const log: Logger = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", jsonObj);
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```
### API documentation:  [TSDoc](https://fullstack-build.github.io/tslog/tsdoc/)
