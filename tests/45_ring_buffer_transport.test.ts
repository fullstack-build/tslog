import { describe, expect, test } from "vitest";
import { Logger } from "../src";
import type { ILogObj, ILogObjMeta } from "../src/interfaces";
import { ringBufferTransport } from "../src/subpaths/transports/ringBuffer";

type Rec = ILogObj & ILogObjMeta;

function makeRecord(n: number): Rec {
  return { n } as unknown as Rec;
}

describe("ringBufferTransport", () => {
  test("rejects a non-positive or non-integer size", () => {
    expect(() => ringBufferTransport({ size: 0 })).toThrow(RangeError);
    expect(() => ringBufferTransport({ size: -3 })).toThrow(RangeError);
    expect(() => ringBufferTransport({ size: 2.5 })).toThrow(RangeError);
  });

  test("dump returns records oldest-first while under capacity", () => {
    const buf = ringBufferTransport({ size: 5 });
    buf.write(makeRecord(1), "");
    buf.write(makeRecord(2), "");
    buf.write(makeRecord(3), "");

    expect(buf.dump().map((r) => (r as { n: number }).n)).toEqual([1, 2, 3]);
  });

  test("keeps only the last N records and evicts the oldest (capacity/eviction + order)", () => {
    const buf = ringBufferTransport({ size: 3 });
    for (let i = 1; i <= 7; i++) {
      buf.write(makeRecord(i), "");
    }

    // capacity respected
    expect(buf.dump()).toHaveLength(3);
    // oldest evicted, newest retained, chronological order
    expect(buf.dump().map((r) => (r as { n: number }).n)).toEqual([5, 6, 7]);
  });

  test("dump returns a fresh copy that does not alias the internal buffer", () => {
    const buf = ringBufferTransport({ size: 2 });
    buf.write(makeRecord(1), "");
    const snapshot = buf.dump();
    buf.write(makeRecord(2), "");
    buf.write(makeRecord(3), "");

    // The earlier snapshot is unaffected by later writes/eviction.
    expect(snapshot.map((r) => (r as { n: number }).n)).toEqual([1]);
    expect(buf.dump().map((r) => (r as { n: number }).n)).toEqual([2, 3]);
  });

  test("clear empties the buffer and resets ordering", () => {
    const buf = ringBufferTransport({ size: 3 });
    buf.write(makeRecord(1), "");
    buf.write(makeRecord(2), "");
    buf.clear();
    expect(buf.dump()).toEqual([]);

    buf.write(makeRecord(9), "");
    expect(buf.dump().map((r) => (r as { n: number }).n)).toEqual([9]);
  });

  test("works as a real attached transport, capturing the last N emitted records", () => {
    const buf = ringBufferTransport({ size: 2 });
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(buf);

    logger.info("first");
    logger.info("second");
    logger.info("third");

    const dumped = buf.dump();
    expect(dumped).toHaveLength(2);
    // The two most recent emitted records, oldest-first.
    expect(dumped[0]["0"]).toBe("second");
    expect(dumped[1]["0"]).toBe("third");
    // Records carry runtime meta.
    expect(dumped[1]._meta.logLevelName).toBe("INFO");
  });
});
