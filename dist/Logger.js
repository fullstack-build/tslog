"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const source_map_support_1 = require("source-map-support");
const LoggerWithoutCallSite_1 = require("./LoggerWithoutCallSite");
/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
class Logger extends LoggerWithoutCallSite_1.LoggerWithoutCallSite {
    /**
     * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
     * @param parentSettings - Used internally to
     */
    constructor(settings, parentSettings) {
        super(settings, parentSettings);
        this._callSiteWrapper = source_map_support_1.wrapCallSite;
    }
}
exports.Logger = Logger;
//# sourceMappingURL=Logger.js.map