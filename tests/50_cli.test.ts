import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Logger } from "../src/index.node.js";
import { createCliFormatter, parseAndFormatLine, parseCliArgs, parseLine, runCli } from "../src/subpaths/cli.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

// M3.11 — `tslog/cli` + the `tslog` bin: read NDJSON from stdin, pretty-print each line via tslog's own
// pretty formatter, filter by -l/--level, pass non-JSON lines through unchanged. The pure transform
// (parse + format + filter) is tested directly here — no process is ever spawned.

/** Capture the JSON lines a `type: "json"` logger would write, so we feed REAL tslog NDJSON to the CLI. */
function captureJsonLines(emit: (log: Logger<unknown>) => void): string[] {
  const log = new Logger<unknown>({ type: "json" });
  // The node entry writes json through the buffered stdout sink, not console.log — the shared helper
  // captures both and forces the sink flush.
  return captureDefaultJsonLines(() => {
    emit(log);
  });
}

describe("tslog/cli (M3.11)", () => {
  describe("parseLine", () => {
    test("classifies a JSON object line as json and reconstructs meta", () => {
      const [line] = captureJsonLines((log) => log.info("hello", { user: "alice" }));
      const parsed = parseLine(line);
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.logLevelName).toBe("INFO");
      expect(parsed.meta?.logLevelId).toBe(3);
      expect(parsed.meta?.date).toBeInstanceOf(Date);
    });

    test("treats non-JSON, empty, array and scalar lines as raw passthrough", () => {
      expect(parseLine("not json at all")).toEqual({ kind: "raw", line: "not json at all" });
      expect(parseLine("")).toEqual({ kind: "raw", line: "" });
      expect(parseLine("[1,2,3]")).toEqual({ kind: "raw", line: "[1,2,3]" });
      expect(parseLine("{ broken json")).toEqual({ kind: "raw", line: "{ broken json" });
    });

    test("a valid JSON scalar/null is treated as raw passthrough", () => {
      // Parses successfully but is not an object -> raw (cli.ts parseLine null/non-object guard).
      expect(parseLine("null")).toEqual({ kind: "raw", line: "null" });
      expect(parseLine("42")).toEqual({ kind: "raw", line: "42" });
    });

    test("reads a string logLevelId from _logMeta (serialized form) and reconstructs the level", () => {
      // Everything in serialized JSON can be a string; readLevelId coerces "5" -> 5 (cli.ts 69-72).
      const parsed = parseLine('{"message":"m","_logMeta":{"logLevelId":"5","logLevelName":"ERROR","date":"2026-07-05T00:00:00.000Z"}}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.logLevelId).toBe(5);
      expect(parsed.meta?.date).toBeInstanceOf(Date);
    });

    test("falls back to the top-level `levelId` envelope field when _logMeta lacks logLevelId", () => {
      // No logLevelId in _logMeta -> readLevelId reads record.levelId (cli.ts 74-75).
      const parsed = parseLine('{"message":"m","levelId":4,"_logMeta":{"logLevelName":"WARN"}}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.logLevelId).toBe(4);
    });

    test("a JSON object without a _logMeta property parses with meta undefined", () => {
      // raw _logMeta is null/absent -> reconstructMeta early-returns undefined (cli.ts 85-87).
      const parsed = parseLine('{"message":"no meta here","user":"bob"}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta).toBeUndefined();
    });

    test("a non-object _logMeta value is ignored (meta undefined)", () => {
      const parsed = parseLine('{"message":"m","_logMeta":"not an object"}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta).toBeUndefined();
    });

    test("reconstructs meta defaults from a bare _logMeta: missing level/date/name/runtime", () => {
      // _logMeta present but with none of the level/date/name/parentNames/runtime fields, and no top-level
      // levelId -> levelId defaults to 0, name stays undefined, date defaults to now, runtime -> "node"
      // (cli.ts 89-95, 104), levelName falls back to record.level string.
      const parsed = parseLine('{"level":"info","_logMeta":{"name":"[undefined]","parentNames":"not-an-array","runtime":123}}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.logLevelId).toBe(0);
      expect(parsed.meta?.logLevelName).toBe("info"); // from record.level
      expect(parsed.meta?.name).toBeUndefined(); // "[undefined]" -> undefined
      expect(parsed.meta?.parentNames).toBeUndefined(); // non-array -> undefined
      expect(parsed.meta?.runtime).toBe("node"); // non-string -> "node"
      expect(parsed.meta?.date).toBeInstanceOf(Date);
    });

    test("levelName is empty when neither _logMeta.logLevelName nor record.level is a string", () => {
      const parsed = parseLine('{"_logMeta":{"date":"2026-07-05T00:00:00.000Z"}}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.logLevelName).toBe("");
    });

    test("keeps a real _logMeta.name and parentNames array", () => {
      // A genuine (non-"[undefined]") string name survives, and an array parentNames is kept (cli.ts 94-95).
      const parsed = parseLine('{"message":"m","_logMeta":{"logLevelId":3,"name":"worker-7","parentNames":["root","api"]}}');
      expect(parsed.kind).toBe("json");
      if (parsed.kind !== "json") throw new Error("unreachable");
      expect(parsed.meta?.name).toBe("worker-7");
      expect(parsed.meta?.parentNames).toEqual(["root", "api"]);
    });
  });

  describe("createCliFormatter / transform", () => {
    test("pretty-prints a JSON line using tslog's pretty formatter (message + fields visible)", () => {
      const [line] = captureJsonLines((log) => log.warn("disk almost full", { freeMb: 12 }));
      const { transform } = createCliFormatter({ color: false });
      const rendered = transform(line);
      expect(rendered).not.toBeNull();
      expect(rendered).toContain("WARN");
      expect(rendered).toContain("disk almost full");
      expect(rendered).toContain("freeMb");
      // color: false -> no ANSI escape codes in the output.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes.
      expect(rendered).not.toMatch(/\[/);
    });

    test("renders fields-first JSON (no top-level message) by reconstructing the object arg", () => {
      const [line] = captureJsonLines((log) => log.info({ event: "tool_call", tool: "search" }));
      const rendered = createCliFormatter({ color: false }).transform(line);
      expect(rendered).toContain("tool_call");
      expect(rendered).toContain("search");
    });

    test("preserves positional args emitted under numeric keys", () => {
      const [line] = captureJsonLines((log) => log.info("two objects", { a: 1 }, { b: 2 }));
      const rendered = createCliFormatter({ color: false }).transform(line);
      expect(rendered).toContain("two objects");
      expect(rendered).toContain("b");
    });

    test("passes a non-JSON line through unchanged", () => {
      const { transform } = createCliFormatter({ color: false });
      expect(transform("plain text banner line")).toBe("plain text banner line");
    });
  });

  describe("level filtering (-l/--level)", () => {
    test("drops records below minLevel and keeps those at or above", () => {
      const lines = captureJsonLines((log) => {
        log.debug("a debug message");
        log.error("an error message");
      });
      const { transform, minLevelId } = createCliFormatter({ minLevel: "warn", color: false });
      expect(minLevelId).toBe(4);
      expect(transform(lines[0])).toBeNull(); // DEBUG(2) < WARN(4)
      expect(transform(lines[1])).not.toBeNull(); // ERROR(5) >= WARN(4)
      expect(transform(lines[1])).toContain("an error message");
    });

    test("accepts a numeric minLevel", () => {
      const lines = captureJsonLines((log) => {
        log.info("info line");
        log.fatal("fatal line");
      });
      const { transform } = createCliFormatter({ minLevel: 6, color: false });
      expect(transform(lines[0])).toBeNull();
      expect(transform(lines[1])).not.toBeNull();
    });

    test("never filters non-JSON passthrough lines regardless of minLevel", () => {
      const { transform } = createCliFormatter({ minLevel: "fatal", color: false });
      expect(transform("some raw stderr line")).toBe("some raw stderr line");
    });

    test("with no minLevel, prints everything", () => {
      const { minLevelId, transform } = createCliFormatter({ color: false });
      expect(minLevelId).toBe(Number.NEGATIVE_INFINITY);
      const [line] = captureJsonLines((log) => log.silly("very low level"));
      expect(transform(line)).not.toBeNull();
    });

    test("an unknown --level name resolves to no filter (-Infinity)", () => {
      // resolveLogLevelId returns undefined for an unknown name -> the no-filter (-Infinity) fallback.
      const { minLevelId } = createCliFormatter({ minLevel: "no-such-level", color: false });
      expect(minLevelId).toBe(Number.NEGATIVE_INFINITY);
    });
  });

  describe("parseAndFormatLine", () => {
    test("works against a manually-supplied formatting context", () => {
      const logger = new Logger<unknown>({ type: "pretty", pretty: { style: false } });
      const ctx = {
        prettyFormatLine: logger.runtime.prettyFormatLine.bind(logger.runtime) as never,
        settings: logger.settings as never,
        minLevelId: 4,
        metaProperty: "_logMeta",
      };
      const [warn] = captureJsonLines((log) => log.warn("kept"));
      const [info] = captureJsonLines((log) => log.info("dropped"));
      expect(parseAndFormatLine(warn, ctx)).toContain("kept");
      expect(parseAndFormatLine(info, ctx)).toBeNull();
      expect(parseAndFormatLine("raw line", ctx)).toBe("raw line");
    });

    test("a record with no discernible level uses the -Infinity fallback for its level id", () => {
      const logger = new Logger<unknown>({ type: "pretty", pretty: { style: false } });
      // With NO filter (minLevelId = -Infinity), an unlevelled record still prints: readLevelId returns
      // undefined -> the `?? -Infinity` fallback (cli.ts 191), and -Infinity is not < -Infinity.
      const noFilterCtx = {
        prettyFormatLine: logger.runtime.prettyFormatLine.bind(logger.runtime) as never,
        settings: logger.settings as never,
        minLevelId: Number.NEGATIVE_INFINITY,
        metaProperty: "_logMeta",
      };
      const rendered = parseAndFormatLine('{"message":"unlevelled"}', noFilterCtx);
      expect(rendered).not.toBeNull();
      expect(rendered).toContain("unlevelled");

      // And with any real filter set, that same -Infinity level is treated as below it, so it is dropped.
      const filteredCtx = { ...noFilterCtx, minLevelId: 0 };
      expect(parseAndFormatLine('{"message":"unlevelled"}', filteredCtx)).toBeNull();
    });

    test("a record with only envelope/meta fields falls back to rendering the whole record", () => {
      const logger = new Logger<unknown>({ type: "pretty", pretty: { style: false } });
      const ctx = {
        prettyFormatLine: logger.runtime.prettyFormatLine.bind(logger.runtime) as never,
        settings: logger.settings as never,
        minLevelId: Number.NEGATIVE_INFINITY,
        metaProperty: "_logMeta",
      };
      // Only envelope keys (level/levelId/time) + _logMeta, no message/fields/positional args -> recordToArgs
      // produces an empty args list and falls back to pushing the whole record (cli.ts 140-142).
      const rendered = parseAndFormatLine('{"level":"info","levelId":3,"time":"2026-07-05T00:00:00.000Z","_logMeta":{"logLevelId":3}}', ctx);
      expect(rendered).not.toBeNull();
      // The record itself is rendered, so its envelope keys appear in the pretty output.
      expect(rendered).toContain("levelId");
    });
  });

  describe("parseCliArgs", () => {
    test("parses -l/--level (name and number) and color flags", () => {
      expect(parseCliArgs(["-l", "warn"])).toEqual({ minLevel: "warn" });
      expect(parseCliArgs(["--level", "5"])).toEqual({ minLevel: 5 });
      expect(parseCliArgs(["--level=info"])).toEqual({ minLevel: "info" });
      expect(parseCliArgs(["--no-color"])).toEqual({ color: false });
      expect(parseCliArgs(["--color"])).toEqual({ color: true });
      expect(parseCliArgs([])).toEqual({});
    });

    test("ignores a trailing --level with no value", () => {
      expect(parseCliArgs(["--level"])).toEqual({});
    });

    test("parses a numeric --level=<n> value as a number", () => {
      // The `--level=` numeric branch (cli.ts 243): a digits-only value becomes a number.
      expect(parseCliArgs(["--level=3"])).toEqual({ minLevel: 3 });
    });
  });

  describe("color resolution (no explicit --color/--no-color)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    test("FORCE_COLOR opts into styled output", () => {
      vi.stubEnv("FORCE_COLOR", "1");
      vi.stubEnv("NO_COLOR", "");
      // No `color` option -> forceColorRequested() branch (cli.ts 210) resolves style to true.
      const [line] = captureJsonLines((log) => log.warn("styled"));
      const rendered = createCliFormatter().transform(line);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the presence of an ANSI escape.
      expect(rendered).toMatch(/\[/);
    });

    test("NO_COLOR suppresses styled output", () => {
      vi.stubEnv("NO_COLOR", "1");
      vi.stubEnv("FORCE_COLOR", "");
      // noColorRequested() branch (cli.ts 210) resolves style to false.
      const [line] = captureJsonLines((log) => log.warn("plain"));
      const rendered = createCliFormatter().transform(line);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the ABSENCE of an ANSI escape.
      expect(rendered).not.toMatch(/\[/);
    });

    test("with no env override, color follows whether stdout is a TTY", () => {
      vi.stubEnv("NO_COLOR", "");
      vi.stubEnv("FORCE_COLOR", "");
      const [line] = captureJsonLines((log) => log.warn("piped"));
      // Swap stdout's TTY flag both ways, restoring the ORIGINAL descriptor in finally so a failing
      // assertion cannot leak a fake stdout state into every later test in this worker.
      const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      let styled: string | null = null;
      let rendered: string | null = null;
      try {
        // stdoutIsTTY() -> true resolves style to true: ANSI styling present.
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
        styled = createCliFormatter().transform(line);
        // stdoutIsTTY() -> false keeps the output plain.
        Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
        rendered = createCliFormatter().transform(line);
      } finally {
        if (originalDescriptor != null) {
          Object.defineProperty(process.stdout, "isTTY", originalDescriptor);
        } else {
          // biome-ignore lint/performance/noDelete: restore the property-absent state the test started from
          delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
        }
      }
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the PRESENCE of an ANSI escape.
      expect(styled).toMatch(/\x1b\[/);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the ABSENCE of an ANSI escape.
      expect(rendered).not.toMatch(/\[/);
    });
  });

  describe("runCli (stream wiring)", () => {
    test("streams stdin through the formatter to stdout, splitting on newlines and passing raw lines", async () => {
      const lines = captureJsonLines((log) => {
        log.info("first");
        log.error("second");
      });
      const input = new PassThrough();
      const output = new PassThrough();
      const collected: string[] = [];
      output.on("data", (chunk: Buffer) => collected.push(chunk.toString("utf8")));

      const done = runCli(input, output, { color: false });
      // A JSON line, a raw line, then a JSON line with no trailing newline (flushed on end).
      input.write(`${lines[0]}\n`);
      input.write("a raw passthrough line\n");
      input.write(lines[1]);
      input.end();
      await done;

      const out = collected.join("");
      expect(out).toContain("first");
      expect(out).toContain("a raw passthrough line");
      expect(out).toContain("second");
    });

    test("filters by minLevel while streaming", async () => {
      const lines = captureJsonLines((log) => {
        log.debug("low");
        log.error("high");
      });
      const input = new PassThrough();
      const output = new PassThrough();
      const collected: string[] = [];
      output.on("data", (chunk: Buffer) => collected.push(chunk.toString("utf8")));

      const done = runCli(input, output, { minLevel: "warn", color: false });
      input.write(`${lines[0]}\n${lines[1]}\n`);
      input.end();
      await done;

      const out = collected.join("");
      expect(out).not.toContain("low");
      expect(out).toContain("high");
    });
  });
});
