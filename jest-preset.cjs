const ts_preset = require("ts-jest/presets/default-esm/jest-preset.js");
const puppeteer_preset = require("jest-puppeteer/jest-preset.js");

module.exports = Object.assign(ts_preset, puppeteer_preset);
