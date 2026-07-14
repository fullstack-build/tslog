import type { ILogObj, ILogObjMeta, Transport } from "../../interfaces.js";

/** Options for {@link ringBufferTransport}. */
export interface IRingBufferOptions {
  /**
   * Maximum number of records to retain. Once the buffer is full the oldest record is evicted as
   * each new one arrives, so {@link IRingBufferTransport.dump} always returns at most `size` entries.
   * Must be a positive integer.
   */
  size: number;
}

/**
 * A {@link Transport} that keeps the last N records in memory (a fixed-capacity ring buffer) and
 * exposes them on demand — handy for attaching a tail of recent debug/trace logs to an error report
 * without persistently emitting them anywhere.
 */
export interface IRingBufferTransport<LogObj> extends Transport<LogObj> {
  /**
   * Return the retained records in chronological order (oldest first, newest last). The returned
   * array is a fresh copy, so mutating it does not affect the buffer.
   */
  dump(): (LogObj & ILogObjMeta)[];
  /** Drop all retained records. */
  clear(): void;
}

/**
 * Create an in-memory ring-buffer transport keeping the most recent `size` records.
 *
 * `write` appends the finished record; once capacity is reached the oldest record is overwritten.
 * `dump()` returns the buffered records oldest-first; `clear()` empties the buffer. The transport is
 * synchronous and never throws on `write`, so it is safe to attach alongside other sinks.
 *
 * @example
 * import { Logger } from "tslog";
 * import { ringBufferTransport } from "tslog/transports/ringbuffer";
 *
 * const recent = ringBufferTransport({ size: 100 });
 * const logger = new Logger();
 * logger.attachTransport(recent);
 * // ...later, when an error happens:
 * console.error("recent logs:", recent.dump());
 */
export function ringBufferTransport<LogObj = ILogObj>({ size }: IRingBufferOptions): IRingBufferTransport<LogObj> {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`ringBufferTransport: "size" must be a positive integer, received ${String(size)}`);
  }

  // Fixed-capacity circular buffer. `count` tracks how many slots are populated, `head` points at
  // the slot the next write will use (and, once full, the oldest record to be evicted).
  const buffer: (LogObj & ILogObjMeta)[] = new Array<LogObj & ILogObjMeta>(size);
  let head = 0;
  let count = 0;

  return {
    name: "ringBuffer",
    write(record: LogObj & ILogObjMeta): void {
      buffer[head] = record;
      head = (head + 1) % size;
      if (count < size) count++;
    },
    dump(): (LogObj & ILogObjMeta)[] {
      const out = new Array<LogObj & ILogObjMeta>(count);
      // When full, the oldest record sits at `head`; otherwise the buffer was filled from index 0.
      const start = count === size ? head : 0;
      for (let i = 0; i < count; i++) {
        out[i] = buffer[(start + i) % size];
      }
      return out;
    },
    clear(): void {
      buffer.length = 0;
      buffer.length = size;
      head = 0;
      count = 0;
    },
  };
}
