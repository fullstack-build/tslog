"use strict";
/*
 We use this file with ts-node-dev to enforce TypeScript execution of libraries during development.
 */
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
Object.defineProperty(exports, "__esModule", { value: true });

if (process[Symbol.for("ts-node.register.instance")] != null) {
  __export(require("./src/index.ts"));
} else {
  __export(require("./dist/index.js"));
}

