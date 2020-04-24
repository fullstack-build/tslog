## 📝 tslog: Expressive TypeScript Logger for Node.js


![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
![npm version](https://img.shields.io/npm/v/tslog?color=76c800&logoColor=76c800&style=flat-square)
![Dependency status](https://img.shields.io/david/fullstack-build/tslog?style=flat-square)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

> Powerful yet expressive and fast logging for TypeScript and Node.js 

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog_pretty_output.png "tslog pretty output")

### Highlights
- [x] Small footprint, great performance
- [x] Native TypeScript support (correct location in *.ts files)
- [x] Works for TypeScript and JavaScript
- [x] Log levels
- [x] Attachable transports
- [x] _Structured_ or _JSON_ output
- [x] Beauty object and error interpolation (with stack trace)
- [x] Stack trace through native V8 API
- [x] Stack trace position linked to position in IDE
- [x] well documented
- [x] 100% test coverage

#### Example: 
```ts
import { Logger } from "tslog";

const log: Logger = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
```
