export function jsonStringifyRecursive(obj: unknown) {
  const cache = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (cache.has(value)) {
        // Circular reference found, discard key
        return "[Circular]";
      }
      // Store value in our collection
      cache.add(value);
    }
    if (typeof value === "bigint") {
      return `${value}`;
    }
    return value;
  });
}
