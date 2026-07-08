import { createRequire } from "node:module";
import { devWarningsEnabled } from "../core/settings.js";
import { safeEnvGet } from "../internal/environment.js";
import type { SourceMapResolver } from "./shared.js";

/**
 * Best-effort source-map resolution for Node/Bun/Deno server-style stack frames (issue #307): a
 * transpiled/bundled frame like `dist/index.js:42:9` is remapped to its original `src/index.ts:12:3`
 * when a source map is discoverable, so error output matches what devtools/`--enable-source-maps`
 * already show for `console.log`. Node's own V8 stack rewriting only fires when the process was
 * started with `--enable-source-maps`, and Bun does not honor that flag at all (verified: Bun leaves
 * `.stack` pointing at the bundled file even with a `sourceMappingURL` comment present) — so this is a
 * manual fallback, not a duplicate of Node's native behavior.
 *
 * Zero runtime dependencies (project convention): this hand-rolls a minimal source-map v3 consumer
 * (Base64-VLQ decode + a segment scan) instead of pulling in the `source-map` package. `node:fs` and
 * `node:module` are resolved lazily via `createRequire`, never imported at module top level, so this
 * file stays side-effect free and is only ever reached from the Node/universal (Bun/Deno) providers —
 * never from the browser bundle.
 *
 * Every failure mode (no `sourceMappingURL`, unreadable file, malformed JSON, no matching segment)
 * resolves to `undefined` and the caller keeps the original transpiled position. This must never throw
 * and never slow down logging when no source map is present.
 */

const BASE64_VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VLQ_INDEX: Record<string, number> = Object.fromEntries([...BASE64_VLQ_CHARS].map((char, index) => [char, index]));

interface RawSourceMap {
  version?: number;
  sources?: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings?: string;
  sourceRoot?: string;
}

/** One decoded mapping segment: generated position -> original position. */
interface MappingSegment {
  genLine: number;
  genColumn: number;
  sourceIndex: number;
  origLine: number;
  origColumn: number;
}

export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
}

interface ParsedSourceMap {
  sources: string[];
  sourceRoot: string;
  segmentsByLine: Map<number, MappingSegment[]>;
}

/** Decode one Base64-VLQ run into signed integers (source-map spec: 5 mantissa bits/char, MSB = continuation, LSB = sign). */
function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let result = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    const digit = BASE64_VLQ_INDEX[char];
    if (digit == null) {
      continue;
    }
    const continuation = digit & 32;
    const bits = digit & 31;
    result += bits << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negate = result & 1;
    result >>= 1;
    values.push(negate ? -result : result);
    result = 0;
    shift = 0;
  }
  return values;
}

/** Parse a source-map v3 `mappings` string into per-generated-line segment lists, sorted by column. */
function parseMappings(mappings: string): Map<number, MappingSegment[]> {
  const segmentsByLine = new Map<number, MappingSegment[]>();
  const lines = mappings.split(";");
  let sourceIndex = 0;
  let origLine = 0;
  let origColumn = 0;

  for (let genLine = 0; genLine < lines.length; genLine += 1) {
    let genColumn = 0;
    const line = lines[genLine];
    if (line.length === 0) {
      continue;
    }
    const lineSegments: MappingSegment[] = [];
    for (const rawSegment of line.split(",")) {
      if (rawSegment.length === 0) {
        continue;
      }
      const fields = decodeVlq(rawSegment);
      if (fields.length < 4) {
        continue;
      }
      genColumn += fields[0];
      sourceIndex += fields[1];
      origLine += fields[2];
      origColumn += fields[3];
      lineSegments.push({ genLine, genColumn, sourceIndex, origLine, origColumn });
    }
    if (lineSegments.length > 0) {
      lineSegments.sort((a, b) => a.genColumn - b.genColumn);
      segmentsByLine.set(genLine, lineSegments);
    }
  }
  return segmentsByLine;
}

function requireNodeModule<T>(name: string): T | undefined {
  try {
    const require = createRequire(import.meta.url);
    return require(name) as T;
    /* v8 ignore next 3 -- defensive: node:fs is always resolvable on Node/Bun/Deno; covers exotic loaders */
  } catch {
    return undefined;
  }
}

type FsLike = { readFileSync: (path: string, encoding: "utf8") => string; existsSync: (path: string) => boolean };

let cachedFs: FsLike | null | undefined;
function getFs(): FsLike | undefined {
  if (cachedFs === undefined) {
    cachedFs = requireNodeModule<FsLike>("node:fs") ?? null;
  }
  return cachedFs ?? undefined;
}

function dirnameOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index === -1 ? "." : filePath.slice(0, index);
}

function joinPath(dir: string, relative: string): string {
  if (/^([A-Za-z]:)?[/\\]/.test(relative)) {
    return relative;
  }
  return `${dir.replace(/[/\\]+$/, "")}/${relative}`;
}

/** Read the trailing `//# sourceMappingURL=...` comment (last one wins, per spec) from a source file. */
function extractSourceMappingUrl(source: string): string | undefined {
  const matches = source.match(/\/[*/]#\s*sourceMappingURL=([^\s*]+)\s*(?:\*\/)?\s*$/gm);
  if (matches == null || matches.length === 0) {
    return undefined;
  }
  const last = matches[matches.length - 1];
  const urlMatch = last.match(/sourceMappingURL=([^\s*]+)/);
  return urlMatch?.[1];
}

function loadRawSourceMap(filePath: string, fs: FsLike): RawSourceMap | undefined {
  let fileContents: string;
  try {
    fileContents = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }

  const mappingUrl = extractSourceMappingUrl(fileContents);
  if (mappingUrl == null) {
    return undefined;
  }

  try {
    if (mappingUrl.startsWith("data:")) {
      const base64Marker = "base64,";
      const base64Index = mappingUrl.indexOf(base64Marker);
      if (base64Index === -1) {
        return undefined;
      }
      const decoded = Buffer.from(mappingUrl.slice(base64Index + base64Marker.length), "base64").toString("utf8");
      return JSON.parse(decoded) as RawSourceMap;
    }

    const mapPath = joinPath(dirnameOf(filePath), mappingUrl);
    if (!fs.existsSync(mapPath)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(mapPath, "utf8")) as RawSourceMap;
  } catch {
    return undefined;
  }
}

/** Parsed-map cache, keyed by the generated file's path — a process only ever has finitely many loaded modules. */
const parsedMapCache = new Map<string, ParsedSourceMap | null>();

function getParsedSourceMap(filePath: string): ParsedSourceMap | undefined {
  const cached = parsedMapCache.get(filePath);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  const fs = getFs();
  /* v8 ignore next 4 -- defensive: node:fs is always resolvable on Node/Bun/Deno, the only runtimes this resolver is wired into */
  if (fs == null) {
    parsedMapCache.set(filePath, null);
    return undefined;
  }

  const raw = loadRawSourceMap(filePath, fs);
  if (raw?.mappings == null || raw.sources == null || raw.sources.length === 0) {
    parsedMapCache.set(filePath, null);
    return undefined;
  }

  const parsed: ParsedSourceMap = {
    sources: raw.sources,
    sourceRoot: raw.sourceRoot ?? "",
    segmentsByLine: parseMappings(raw.mappings),
  };
  parsedMapCache.set(filePath, parsed);
  return parsed;
}

/** Find the mapping segment on `genLine` at or immediately before `genColumn` (source maps snap to segment start). */
function findSegment(segments: MappingSegment[], genColumn: number): MappingSegment | undefined {
  let candidate: MappingSegment | undefined;
  for (const segment of segments) {
    if (segment.genColumn > genColumn) {
      break;
    }
    candidate = segment;
  }
  return candidate;
}

/**
 * Resolve a transpiled/bundled `(filePath, line, column)` (1-based line, as produced by V8 stack
 * frames) to its original source position via that file's source map, if one is discoverable.
 * Returns `undefined` on any failure — no source map, unparsable map, or no covering segment — so
 * callers can fall back to the transpiled position unconditionally.
 */
export function resolveOriginalPosition(filePath: string, line: number, column: number): OriginalPosition | undefined {
  if (!Number.isFinite(line) || line < 1) {
    return undefined;
  }
  const map = getParsedSourceMap(filePath);
  if (map == null) {
    return undefined;
  }

  const segments = map.segmentsByLine.get(line - 1);
  if (segments == null || segments.length === 0) {
    return undefined;
  }

  const zeroBasedColumn = Number.isFinite(column) && column >= 1 ? column - 1 : 0;
  const segment = findSegment(segments, zeroBasedColumn) ?? segments[0];
  const source = map.sources[segment.sourceIndex];
  if (source == null) {
    return undefined;
  }

  const resolvedSource = map.sourceRoot.length > 0 ? joinPath(map.sourceRoot, source) : source;
  return { source: resolvedSource, line: segment.origLine + 1, column: segment.origColumn + 1 };
}

/** Clear the parsed-source-map cache. Exposed for tests only. */
export function clearSourceMapCacheForTests(): void {
  parsedMapCache.clear();
}

/**
 * Whether source-map resolution should be attempted: on by default outside production (matching
 * {@link devWarningsEnabled}'s `NODE_ENV` check — this is a dev-ergonomics feature, and the sync file
 * reads it costs are not something a production deployment should pay for), with a dedicated
 * `TSLOG_SOURCE_MAPS` override so it can be forced on/off independent of dev-warning noise.
 */
export function sourceMapResolutionEnabled(): boolean {
  const override = safeEnvGet("TSLOG_SOURCE_MAPS");
  if (override != null) {
    return override !== "off" && override !== "false" && override !== "0";
  }
  return devWarningsEnabled();
}

/**
 * Build the {@link SourceMapResolver} the node/universal providers inject into `providerBase`, or
 * `undefined` when resolution is disabled (production default, or `TSLOG_SOURCE_MAPS=off`) — passing
 * `undefined` means `parseServerStackLine` skips resolution entirely, at zero per-call cost.
 */
export function createSourceMapResolver(): SourceMapResolver | undefined {
  if (!sourceMapResolutionEnabled()) {
    return undefined;
  }
  return (filePath, line, column) => resolveOriginalPosition(filePath, line, column);
}
