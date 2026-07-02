import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Logger } from "../src/index.node.js";
import { type WorkerTransport, workerTransport } from "../src/subpaths/transports/worker.js";

// The worker transport runs its destination I/O on a node:worker_threads worker. Each test MUST dispose
// the transport (terminating its worker) or the process keeps a live handle and Vitest hangs — so every
// created transport is registered here and disposed in afterEach.
const open: WorkerTransport<unknown>[] = [];
function track<T>(t: WorkerTransport<T>): WorkerTransport<T> {
  open.push(t as WorkerTransport<unknown>);
  return t;
}

afterEach(async () => {
  while (open.length > 0) {
    const t = open.pop();
    try {
      await t?.[Symbol.asyncDispose]?.();
    } catch {
      // best-effort teardown; never fail a test on disposal
    }
  }
});

function tmpFile(): string {
  // Unique enough without Date.now/Math.random (unavailable in some sandboxes): a module-scoped counter.
  return join(tmpdir(), `tslog-worker-${process.pid}-${counter++}.log`);
}
let counter = 0;

describe("worker transport (tslog/transports/worker)", () => {
  test("implements the async Transport contract", () => {
    const t = track(workerTransport({ destination: "file", path: tmpFile(), format: "json" }));
    expect(typeof t.write).toBe("function");
    expect(typeof t.flush).toBe("function");
    expect(typeof t[Symbol.asyncDispose]).toBe("function");
  });

  test("`file` destination requires a path", () => {
    expect(() => workerTransport({ destination: "file" })).toThrow();
  });

  test("round-trip: lines logged through the worker reach the file, in order", async () => {
    const path = tmpFile();
    const t = track(workerTransport({ destination: "file", path, format: "json" }));
    const log = new Logger({ type: "json", minLevel: 0 });
    const detach = log.attachTransport(t);

    log.info({ n: 1 }, "first");
    log.info({ n: 2 }, "second");
    log.info({ n: 3 }, "third");

    // flush() must resolve once the worker has drained everything queued to disk.
    await t.flush();
    detach();

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.message)).toEqual(["first", "second", "third"]);
    expect(parsed.map((p) => p.n)).toEqual([1, 2, 3]);

    rmSync(path, { force: true });
  });

  test("flush() resolves even with nothing buffered", async () => {
    const t = track(workerTransport({ destination: "file", path: tmpFile(), format: "json" }));
    await expect(t.flush()).resolves.toBeUndefined();
  });

  test("a destination error does not crash logging (transport isolation)", async () => {
    // Point the file at a path that cannot be created (a file used as a directory component) so the worker's
    // write fails; logging must continue and other transports must still run.
    const okPath = tmpFile();
    const okSink = workerTransport({ destination: "file", path: okPath, format: "json" });
    track(okSink);
    const badSink = workerTransport({ destination: "file", path: "/dev/null/cannot/exist.log", format: "json" });
    track(badSink);

    const log = new Logger({ type: "json", minLevel: 0 });
    log.attachTransport(badSink);
    log.attachTransport(okSink);

    expect(() => log.info("survives a bad sink")).not.toThrow();
    await okSink.flush();

    const lines = readFileSync(okPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.some((l) => JSON.parse(l).message === "survives a bad sink")).toBe(true);
    rmSync(okPath, { force: true });
  });
});
