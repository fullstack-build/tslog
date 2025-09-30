const tsPreset = require("ts-jest/presets/default-esm/jest-preset.js");
const puppeteerPreset = require("jest-puppeteer/jest-preset.js");

const baseConfig = {
    verbose: true,
    testTimeout: 100000,
    testEnvironment: "node",
    collectCoverage: true,
    clearMocks: true,
    transform: {
        "^.+\\.m?tsx?$": [
            require.resolve("ts-jest"),
            {
                useESM: false,
                tsconfig: "./tsconfig.jest.json",
            },
        ],
    },
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    testMatch: [
        "**/tests/**/*.test.ts",
        "**/tests/**/*.test.js",
    ],
    coveragePathIgnorePatterns: [
        "<rootDir>/node-modules/",
        "<rootDir>/tests/",
        "<rootDir>/src/internal/util.inspect.polyfill.ts",
    ],
};

module.exports = {
    ...tsPreset,
    ...puppeteerPreset,
    ...baseConfig,
};
