/* Based on https://github.com/watson/error-callsites */
const callsitesSym: symbol = Symbol("callsites");
export { callsitesSym };

const fallback:
  | ((err: Error, stackTraces: NodeJS.CallSite[]) => unknown)
  | undefined = Error.prepareStackTrace;

let lastPrepareStackTrace:
  | ((err: Error, stackTraces: NodeJS.CallSite[]) => unknown)
  | undefined = fallback;

function prepareStackTrace(
  err: Error,
  callsites: NodeJS.CallSite[]
): NodeJS.CallSite[] | unknown {
  // If the symbol has already been set it must mean that someone else has also
  // overwritten `Error.prepareStackTrace` and retains a reference to this
  // function that it's calling every time it's own `prepareStackTrace`
  // function is being called. This would create an infinite loop if not
  // handled.
  if (Object.prototype.hasOwnProperty.call(err, callsitesSym)) {
    return (fallback && fallback(err, callsites)) ?? err.toString();
  }

  Object.defineProperty(err, callsitesSym, {
    enumerable: false,
    configurable: true,
    writable: false,
    value: callsites,
  });

  return (
    (lastPrepareStackTrace && lastPrepareStackTrace(err, callsites)) ??
    err.toString()
  );
}

Object.defineProperty(Error, "prepareStackTrace", {
  configurable: true,
  enumerable: true,
  get: function () {
    return prepareStackTrace;
  },
  set: function (fn?: (err: Error, stackTraces: NodeJS.CallSite[]) => unknown) {
    // Don't set `lastPrepareStackTrace` to ourselves. If we did, we'd end up
    // throwing a RangeError (Maximum call stack size exceeded).
    lastPrepareStackTrace = fn === prepareStackTrace ? fallback : fn;
  },
});

export function getCallSites(err: Error): NodeJS.CallSite[] {
  return err.stack ? err[callsitesSym] : err[callsitesSym];
}
