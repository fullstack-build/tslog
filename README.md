## 📝 tslog: Expressive TypeScript Logger for Node.js


![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

> Powerful yet expressive and fast logging for TypeScript and Node.js 

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_pretty_output.png "tslog pretty output")

### Highlights
- [x] Small footprint, great performance
- [x] Native TypeScript support (correct location in *.ts files)
- [x] Works for TypeScript and JavaScript
- [x] Log levels
- [x] Attachable transports
- [x] _Structured_ or _json_ output
- [x] Stack trace through native V8 API
- [x] Pretty Error with stack trace
- [x] well documented
- [x] 100% test coverage

#### Example: 
```ts
import { Logger } from "tslog";

const log: Logger = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
```
