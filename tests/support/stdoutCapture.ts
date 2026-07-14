import { vi } from "vitest";
import { getStdoutJsonSink } from "../../src/env/stdoutSink.node.js";

/**
 * Capture every default-sink JSON line emitted while `run` executes.
 *
 * The Node entry's `type: "json"` output goes through the buffered stdout sink
 * (`process.stdout.write`, batched per event-loop turn) — NOT `console.log` — while the
 * browser/universal/slim entries still print via `console.log`. This helper spies on BOTH targets,
 * forces the sink's synchronous flush so buffered lines are observable without awaiting a microtask,
 * and returns the captured lines in emission order.
 */
export function captureDefaultJsonLines(run: () => void): string[] {
  const lines: string[] = [];
  const consoleSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    for (const line of String(chunk).split("\n")) {
      if (line.length > 0) {
        lines.push(line);
      }
    }
    // `write(chunk, callback)` — invoke the callback so the sink's pending-write accounting settles
    // (an unsettled write would park a later `logger.flush()` forever).
    for (const arg of rest) {
      if (typeof arg === "function") {
        (arg as () => void)();
      }
    }
    return true;
  }) as never);
  try {
    run();
    getStdoutJsonSink().flushSync();
  } finally {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  }
  return lines;
}
