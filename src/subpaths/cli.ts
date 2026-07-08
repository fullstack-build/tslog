#!/usr/bin/env node
import { resolveLogLevelId } from "../core/levels.js";
import { Logger } from "../index.node.js";
import type { IMeta, ISettings, TLogLevel } from "../interfaces.js";
import { forceColorRequested, noColorRequested, stdoutIsTTY } from "../internal/environment.js";

/**
 * `tslog/cli` + the `tslog` bin (M3.11) — a tiny NDJSON pretty-printer.
 *
 * Pipe JSON-lines produced by a `new Logger({ type: "json" })` (in production / on a server / from a
 * container's stdout) into this command and each line is re-rendered through tslog's **own pretty
 * formatter** — the same meta markup, colors, and `util.inspect` output you'd get locally — so a
 * structured log stream is readable again without any extra tooling:
 *
 * ```sh
 * kubectl logs my-pod | tslog                 # pretty-print everything
 * cat app.ndjson | tslog --level warn         # only WARN and above
 * docker logs api 2>&1 | tslog -l info
 * ```
 *
 * Lines that are not valid JSON (a stray stack trace, a `console.log` from a dependency, a banner)
 * are **passed through unchanged**, so interleaved plain output is never swallowed.
 *
 * The transform is pure and exported ({@link parseAndFormatLine}, {@link createCliFormatter}) so it can
 * be unit-tested without spawning a process or touching stdio. Only {@link runCli} (invoked when this
 * module is the process entry point) reads stdin / writes stdout — that import-time side effect is the
 * single allowlisted entry in the side-effects audit (`subpaths/cli.ts`).
 *
 * @module subpaths/cli
 */

/** Top-level convenience fields tslog's JSON output adds alongside the user's object — not "user data". */
const JSON_ENVELOPE_KEYS: ReadonlySet<string> = new Set(["message", "level", "levelId", "time"]);

/** Result of classifying one input line: a parsed tslog JSON record, or a passthrough raw line. */
export type ParsedLine =
  | { readonly kind: "json"; readonly record: Record<string, unknown>; readonly meta: IMeta | undefined }
  | { readonly kind: "raw"; readonly line: string };

/** Options accepted by the CLI / {@link createCliFormatter}. */
export interface CliOptions {
  /**
   * Minimum level to print, by name or id (e.g. `"warn"`, `"WARN"`, `4`). Lines below it are dropped.
   * Names are matched case-insensitively against the default + custom levels. Default: print all.
   */
  readonly minLevel?: TLogLevel | string;
  /** Property name runtime metadata lives under in the input. Default: `"_logMeta"` (tslog's default). */
  readonly metaProperty?: string;
  /** Force-enable/disable ANSI color in the rendered output. Default: FORCE_COLOR/NO_COLOR, else color only on an interactive TTY. */
  readonly color?: boolean;
}

/** A configured, reusable line transform plus the resolved numeric `minLevel` it filters on. */
export interface CliFormatter {
  /** Pretty-print one input line, or return `null` when the line is a JSON record below `minLevel`. */
  readonly transform: (line: string) => string | null;
  /** The resolved numeric minimum level (`Number.NEGATIVE_INFINITY` when no filter was given). */
  readonly minLevelId: number;
}

/**
 * Read a runtime metadata property as a number, tolerating both the live `IMeta` (numbers) and the
 * JSON-serialized form (where everything is a string).
 */
function readLevelId(meta: Record<string, unknown> | undefined, record: Record<string, unknown>): number | undefined {
  const fromMeta = meta?.logLevelId;
  if (typeof fromMeta === "number") {
    return fromMeta;
  }
  if (typeof fromMeta === "string" && fromMeta.trim() !== "" && Number.isFinite(Number(fromMeta))) {
    return Number(fromMeta);
  }
  // tslog's JSON envelope also surfaces the id at the top level as `levelId`.
  const fromTop = record.levelId;
  return typeof fromTop === "number" ? fromTop : undefined;
}

/**
 * Reconstruct the {@link IMeta} block that drives pretty meta markup from a parsed JSON record. The
 * serialized form stores `date` as an ISO string and ids as numbers; we coerce them back so the pretty
 * formatter sees the same shape it produced.
 */
function reconstructMeta(record: Record<string, unknown>, metaProperty: string): IMeta | undefined {
  const raw = record[metaProperty];
  if (raw == null || typeof raw !== "object") {
    return undefined;
  }
  const meta = raw as Record<string, unknown>;
  const levelId = readLevelId(meta, record) ?? 0;
  const levelName = typeof meta.logLevelName === "string" ? meta.logLevelName : typeof record.level === "string" ? record.level : "";
  const dateValue = meta.date ?? record.time;
  const date = typeof dateValue === "string" || typeof dateValue === "number" ? new Date(dateValue) : new Date();

  const name = typeof meta.name === "string" && meta.name !== "[undefined]" ? meta.name : undefined;
  const parentNames = Array.isArray(meta.parentNames) ? (meta.parentNames as string[]) : undefined;

  return {
    ...(meta as Partial<IMeta>),
    date,
    logLevelId: levelId,
    logLevelName: levelName,
    name,
    parentNames,
    runtime: typeof meta.runtime === "string" ? meta.runtime : "node",
  };
}

/**
 * Split a tslog JSON record back into the positional arguments the pretty formatter consumes: the
 * `message` string (if any) first, then any remaining user fields as one object, then numeric-keyed
 * positional args (`"1"`, `"2"`, …) tslog assigns to non-leading object args — in their original order.
 */
function recordToArgs(record: Record<string, unknown>, metaProperty: string): unknown[] {
  const args: unknown[] = [];
  if (typeof record.message === "string") {
    args.push(record.message);
  }

  const fields: Record<string, unknown> = {};
  const positional: Array<{ index: number; value: unknown }> = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === metaProperty || JSON_ENVELOPE_KEYS.has(key)) {
      continue;
    }
    if (/^\d+$/.test(key)) {
      positional.push({ index: Number(key), value });
      continue;
    }
    fields[key] = value;
  }

  if (Object.keys(fields).length > 0) {
    args.push(fields);
  }
  for (const { value } of positional.sort((a, b) => a.index - b.index)) {
    args.push(value);
  }

  // Nothing structured to show (e.g. a record that was only message/meta-less): fall back to the record.
  if (args.length === 0) {
    args.push(record);
  }
  return args;
}

/**
 * Classify a single input line: parse it as a tslog JSON record (object only — JSON arrays/scalars are
 * treated as raw passthrough), otherwise mark it raw. Never throws.
 */
export function parseLine(line: string, metaProperty = "_logMeta"): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "" || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return { kind: "raw", line };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "raw", line };
    }
    const record = parsed as Record<string, unknown>;
    return { kind: "json", record, meta: reconstructMeta(record, metaProperty) };
  } catch {
    return { kind: "raw", line };
  }
}

/**
 * The core pure transform (M3.11): turn one input line into the line to print, or `null` to drop it.
 *
 * - A valid tslog JSON object whose level is `>= minLevelId` is rendered through `runtime.prettyFormatLine`.
 * - A valid JSON object **below** `minLevelId` returns `null` (filtered out).
 * - Anything that isn't a tslog JSON object is returned unchanged (passthrough).
 *
 * @param line - one raw input line (no trailing newline required).
 * @param ctx - the formatting context (the env's pretty formatter, resolved settings, filter level).
 */
export function parseAndFormatLine(
  line: string,
  ctx: {
    readonly prettyFormatLine: (args: unknown[], meta: IMeta | undefined, settings: ISettings<unknown>) => string;
    readonly settings: ISettings<unknown>;
    readonly minLevelId: number;
    readonly metaProperty: string;
  },
): string | null {
  const parsed = parseLine(line, ctx.metaProperty);
  if (parsed.kind === "raw") {
    return parsed.line;
  }

  const levelId = readLevelId(parsed.meta as unknown as Record<string, unknown> | undefined, parsed.record) ?? Number.NEGATIVE_INFINITY;
  if (levelId < ctx.minLevelId) {
    return null;
  }

  const args = recordToArgs(parsed.record, ctx.metaProperty);
  return ctx.prettyFormatLine(args, parsed.meta, ctx.settings);
}

/**
 * Build a reusable {@link CliFormatter} from {@link CliOptions}. Constructs one pretty {@link Logger} to
 * obtain resolved grouped settings and a runtime pretty formatter, then closes over them so callers can
 * pretty-print many lines (or unit-test the transform) without spawning a process.
 */
export function createCliFormatter(options: CliOptions = {}): CliFormatter {
  const metaProperty = options.metaProperty ?? "_logMeta";
  // Style precedence: an explicit --color/--no-color flag wins outright (resolveStyle honors an explicit
  // `pretty.style` over the env), then FORCE_COLOR / NO_COLOR, then the destination: ANSI only when
  // stdout is an interactive TTY, so a bare pipe to a file or another process stays plain.
  const style = options.color ?? (forceColorRequested() ? true : noColorRequested() ? false : stdoutIsTTY());
  const logger = new Logger<unknown>({
    type: "pretty",
    pretty: { style },
  });
  const settings = logger.settings as unknown as ISettings<unknown>;
  const runtime = logger.runtime;

  // `resolveLogLevelId` tolerates any string (case-insensitive name lookup; unknown -> undefined), so a
  //  free-form CLI value like "warn" resolves; the cast just widens the lowercase string to `TLogLevel`.
  const minLevelId =
    options.minLevel != null ? (resolveLogLevelId(options.minLevel as TLogLevel, settings.customLevels) ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;

  const prettyFormatLine = runtime.prettyFormatLine.bind(runtime) as (args: unknown[], meta: IMeta | undefined, settings: ISettings<unknown>) => string;

  return {
    minLevelId,
    transform: (line: string) => parseAndFormatLine(line, { prettyFormatLine, settings, minLevelId, metaProperty }),
  };
}

/** Parse `argv` (without `node`/script) into {@link CliOptions}. Recognizes `-l`/`--level <name>` and `--no-color`. */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: { minLevel?: TLogLevel | string; color?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-l" || arg === "--level") {
      const value = argv[++i];
      if (value != null) {
        options.minLevel = /^\d+$/.test(value) ? Number(value) : value;
      }
    } else if (arg.startsWith("--level=")) {
      const value = arg.slice("--level=".length);
      options.minLevel = /^\d+$/.test(value) ? Number(value) : value;
    } else if (arg === "--no-color") {
      options.color = false;
    } else if (arg === "--color") {
      options.color = true;
    }
  }
  return options;
}

/**
 * Side-effectful entry: stream lines from `input` through a {@link CliFormatter} to `output`. Splits on
 * newlines, buffering any partial trailing line until more data (or end of stream) completes it. Returns
 * a promise that resolves when the input is fully consumed.
 *
 * This is the only impure function in the module; it's exported for completeness but the testable logic
 * lives entirely in {@link parseAndFormatLine} / {@link createCliFormatter}.
 */
export function runCli(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, options: CliOptions = {}): Promise<void> {
  const formatter = createCliFormatter(options);
  let buffer = "";

  const emit = (line: string): void => {
    const rendered = formatter.transform(line);
    if (rendered != null) {
      output.write(`${rendered}\n`);
    }
  };

  return new Promise<void>((resolve, reject) => {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        emit(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    input.on("end", () => {
      if (buffer.length > 0) {
        emit(buffer.replace(/\r$/, ""));
      }
      resolve();
    });
    input.on("error", reject);
  });
}

// --- CLI entry (allowlisted side effect: subpaths/cli.ts) -------------------------------------------
// Run only when this module is the process entry point, never on plain `import "tslog/cli"`.
/* v8 ignore start -- exercised end-to-end by running the bin, not by the in-process unit tests */
function isMainModule(): boolean {
  if (typeof process === "undefined" || process.argv[1] == null) {
    return false;
  }
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href || import.meta.url.endsWith(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  runCli(process.stdin, process.stdout, parseCliArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`tslog: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
