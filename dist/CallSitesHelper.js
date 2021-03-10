"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCallSites = exports.FormatStackTrace = exports.callsitesSym = void 0;
/* Based on https://github.com/watson/error-callsites */
const callsitesSym = Symbol("callsites");
exports.callsitesSym = callsitesSym;
// Lifted from Node.js 0.10.40:
// https://github.com/nodejs/node/blob/0439a28d519fb6efe228074b0588a59452fc1677/deps/v8/src/messages.js#L1053-L1080
function FormatStackTrace(error, frames) {
    const lines = [];
    try {
        lines.push(error.toString());
    }
    catch (e) {
        lines.push("<error: " + e + ">");
    }
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        let line;
        try {
            line = frame.toString();
        }
        catch (e) {
            line = "<error: " + e + ">";
        }
        lines.push("    at " + line);
    }
    return lines.join("\n");
}
exports.FormatStackTrace = FormatStackTrace;
const fallback = Error.prepareStackTrace || FormatStackTrace;
let lastPrepareStackTrace = fallback;
function prepareStackTrace(err, callsites) {
    var _a;
    // If the symbol has already been set it must mean that someone else has also
    // overwritten `Error.prepareStackTrace` and retains a reference to this
    // function that it's calling every time it's own `prepareStackTrace`
    // function is being called. This would create an infinite loop if not
    // handled.
    if (Object.prototype.hasOwnProperty.call(err, callsitesSym)) {
        return fallback(err, callsites);
    }
    Object.defineProperty(err, callsitesSym, {
        enumerable: false,
        configurable: true,
        writable: false,
        value: callsites,
    });
    return ((_a = (lastPrepareStackTrace && lastPrepareStackTrace(err, callsites))) !== null && _a !== void 0 ? _a : err.toString());
}
Object.defineProperty(Error, "prepareStackTrace", {
    configurable: true,
    enumerable: true,
    get: function () {
        return prepareStackTrace;
    },
    set: function (fn) {
        // Don't set `lastPrepareStackTrace` to ourselves. If we did, we'd end up
        // throwing a RangeError (Maximum call stack size exceeded).
        lastPrepareStackTrace =
            fn === prepareStackTrace
                ? fallback
                : fn;
    },
});
function getCallSites(err) {
    return err.stack ? err[callsitesSym] : err[callsitesSym];
}
exports.getCallSites = getCallSites;
//# sourceMappingURL=CallSitesHelper.js.map