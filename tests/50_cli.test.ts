import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { Logger } from "../src/index.node.js";
import { createCliFormatter, parseAndFormatLine, parseCliArgs, parseLine, runCli } from "../src/subpaths/cli.js";

// M3.11 — `tslog/cli` + the `tslog` bin: read NDJSON from stdin, pretty-print each line via tslog's own
// pretty formatter, filter by -l/--level, pass non-JSON lines through unchanged. The pure transform
// (parse + format + filter) is tested directly here — no process is ever spawned.

/** Capture the JSON lines a `type: "json"` logger would write, so we feed REAL tslog NDJSON to the CLI. */
function captureJsonLines(emit: (log: Logger<unknown>) => void): string[] {
  const log = new Logger<unknown>({ type: "json" });
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    emit(log);
  } finally {
    console.log = original;
  }
  return lines;
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
  });

  describe("parseAndFormatLine", () => {
    test("works against a manually-supplied formatting context", () => {
      const logger = new Logger<unknown>({ type: "pretty", pretty: { style: false } });
      const ctx = {
        prettyFormatLine: logger.runtime.prettyFormatLine.bind(logger.runtime) as never,
        settings: logger.settings as never,
        minLevelId: 4,
        metaProperty: "_meta",
      };
      const [warn] = captureJsonLines((log) => log.warn("kept"));
      const [info] = captureJsonLines((log) => log.info("dropped"));
      expect(parseAndFormatLine(warn, ctx)).toContain("kept");
      expect(parseAndFormatLine(info, ctx)).toBeNull();
      expect(parseAndFormatLine("raw line", ctx)).toBe("raw line");
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
