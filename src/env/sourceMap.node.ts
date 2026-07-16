import { createRequire } from "node:module";
import { devWarningsEnabled } from "../core/settings.js";
import { safeEnvGet } from "../internal/environment.js";
import { normalizeFilePath, type SourceMapResolver } from "./shared.js";

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
 * (Base64-VLQ decode + a segment scan, including indexed maps — the `sections` form emitted by
 * Turbopack and other concatenating bundlers) instead of pulling in the `source-map` package. `node:fs` and
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
  sections?: SourceMapSection[];
}

interface SourceMapSection {
  offset: { line: number; column: number };
  map?: RawSourceMap;
  url?: string; // external sub-map url (relative to outer map)
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

/** A parsed flat (non-indexed) map: per-line segments ready for binary search. */
interface ParsedFlatMap {
  kind: "flat";
  sources: string[];
  sourceRoot: string;
  /** Directory the map's relative `sources` entries resolve against: the `.map` file's own directory (the generated file's for inline `data:` maps). */
  mapDir: string;
  segmentsByLine: Map<number, MappingSegment[]>;
}

/** One parsed section of an index map: 0-based generated offset plus its (eagerly parsed) sub-map. */
interface ParsedSection {
  offsetLine: number;
  offsetColumn: number;
  /** Parsed sub-map; `undefined` when the section's `map`/`url` was missing or unparsable. */
  map?: ParsedSourceMap;
}

/** A parsed index map (`sections`, emitted by Turbopack and other concatenating bundlers). */
interface ParsedSectionedMap {
  kind: "sectioned";
  sections: ParsedSection[];
}

type ParsedSourceMap = ParsedFlatMap | ParsedSectionedMap;

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
  // Bundlers rewrite a variable-argument `require(name)` into an always-throwing stub (Turbopack:
  // "expression is too dynamic"), which would silently disable source-map resolution inside bundled
  // server apps (Next.js dev). `process.getBuiltinModule` is a plain runtime call bundlers leave
  // untouched, so try it first (Node >= 20.16, Deno 2, modern Bun); `createRequire` stays as the
  // fallback for older Node 20.x, where this module only ever runs unbundled.
  const getBuiltin = typeof process !== "undefined" ? process.getBuiltinModule : undefined;
  if (typeof getBuiltin === "function") {
    try {
      const resolved = getBuiltin(name) as T | undefined;
      if (resolved != null) {
        return resolved;
      }
      /* v8 ignore next 3 -- defensive: getBuiltinModule("node:fs") cannot throw on the runtimes that reach it */
    } catch {
      // fall through to createRequire
    }
  }
  /* v8 ignore next 6 -- reachable only on runtimes without getBuiltinModule (Node 20.0-20.15); the test runners are newer */
  try {
    const require = createRequire(import.meta.url);
    return require(name) as T;
  } catch {
    return undefined;
  }
}

type FsLike = { readFileSync: (path: string, encoding: "utf8") => string; existsSync: (path: string) => boolean };

let cachedFs: FsLike | null | undefined;
function getFs(): FsLike | undefined {
  if (cachedFs === undefined) {
    /* v8 ignore next 3 -- defensive: node:fs is always resolvable on Node/Bun/Deno, the only runtimes this resolver is wired into */
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

/** A parsed raw map plus the directory its relative `sources` entries resolve against. */
interface LoadedSourceMap {
  raw: RawSourceMap;
  mapDir: string;
}

function loadRawSourceMap(filePath: string, fs: FsLike): LoadedSourceMap | undefined {
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
      return { raw: JSON.parse(decoded) as RawSourceMap, mapDir: dirnameOf(filePath) };
    }

    // `sourceMappingURL` is a URL, so file names containing characters like `[`/`]` arrive
    // percent-encoded — Turbopack references its on-disk `[root-of-the-server]__x._.js.map` as
    // `%5Broot-of-the-server%5D__x._.js.map`. Prefer the decoded name for the on-disk lookup and
    // fall back to the raw one (a literal `%` in a file name is legal too).
    let decodedUrl = mappingUrl;
    try {
      decodedUrl = decodeURIComponent(mappingUrl);
    } catch {
      // Malformed escape sequence (e.g. a raw "%" in the file name): keep the undecoded URL.
    }
    let mapPath = joinPath(dirnameOf(filePath), decodedUrl);
    if (!fs.existsSync(mapPath) && decodedUrl !== mappingUrl) {
      mapPath = joinPath(dirnameOf(filePath), mappingUrl);
    }
    if (!fs.existsSync(mapPath)) {
      return undefined;
    }
    return { raw: JSON.parse(fs.readFileSync(mapPath, "utf8")) as RawSourceMap, mapDir: dirnameOf(mapPath) };
  } catch {
    return undefined;
  }
}

/** Parsed-map cache, keyed by the generated file's path — a process only ever has finitely many loaded modules. */
const PARSED_MAP_CACHE_LIMIT = 256;
const parsedMapCache = new Map<string, ParsedSourceMap | null>();

function getParsedSourceMap(filePath: string): ParsedSourceMap | undefined {
  const cached = parsedMapCache.get(filePath);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  // Defensive cap: a pathological process could load thousands of modules with source maps. Evict
  // the oldest entry (FIFO — the cost of re-reading one file is negligible) to bound memory.
  if (parsedMapCache.size >= PARSED_MAP_CACHE_LIMIT) {
    const firstKey = parsedMapCache.keys().next().value;
    if (firstKey !== undefined) {
      parsedMapCache.delete(firstKey);
    }
  }

  const fs = getFs();
  /* v8 ignore next 4 -- defensive: node:fs is always resolvable on Node/Bun/Deno, the only runtimes this resolver is wired into */
  if (fs == null) {
    parsedMapCache.set(filePath, null);
    return undefined;
  }

  const loaded = loadRawSourceMap(filePath, fs);
  const parsed = loaded != null ? parseRawMap(loaded.raw, loaded.mapDir, fs) : undefined;
  parsedMapCache.set(filePath, parsed ?? null);
  return parsed;
}

/** Index maps must not nest further index maps (spec), but cap the parse recursion defensively anyway. */
const MAX_SECTION_DEPTH = 2;

/**
 * Parse a raw map — flat or indexed (`sections`, emitted by Turbopack/Next.js dev and other
 * concatenating bundlers) — into its cached representation. Section sub-maps, whether inline (`map`)
 * or external (`url`, resolved relative to the outer map), are parsed eagerly right here, so the
 * whole structure is built exactly once per generated file and resolution never touches the disk
 * again — logging through a sectioned map stays as cheap as through a flat one.
 */
function parseRawMap(raw: RawSourceMap, mapDir: string, fs: FsLike, depth = 0): ParsedSourceMap | undefined {
  if (raw.sections && raw.sections.length > 0) {
    /* v8 ignore next -- defensive: the spec forbids nested index maps, so real-world depth never exceeds 1 */
    if (depth >= MAX_SECTION_DEPTH) return undefined;
    const sections: ParsedSection[] = [];
    for (const section of raw.sections) {
      /* v8 ignore next 2 -- `offset` is required by the spec; the ?? 0 guards malformed maps only */
      const offsetLine = section.offset?.line ?? 0;
      const offsetColumn = section.offset?.column ?? 0;
      let subRaw = section.map;
      let subMapDir = mapDir;
      if (subRaw == null && section.url != null) {
        // External sub-map (rare): load it once at parse time, relative to the outer map's directory.
        try {
          const subPath = joinPath(mapDir, section.url);
          if (fs.existsSync(subPath)) {
            subRaw = JSON.parse(fs.readFileSync(subPath, "utf8")) as RawSourceMap;
            subMapDir = dirnameOf(subPath);
          }
        } catch {
          // Unreadable/malformed external sub-map: keep the section, resolution inside it just misses.
        }
      }
      sections.push({ offsetLine, offsetColumn, map: subRaw != null ? parseRawMap(subRaw, subMapDir, fs, depth + 1) : undefined });
    }
    return { kind: "sectioned", sections };
  }

  if (raw.mappings && raw.sources && raw.sources.length > 0) {
    return { kind: "flat", sources: raw.sources, sourceRoot: raw.sourceRoot ?? "", mapDir, segmentsByLine: parseMappings(raw.mappings) };
  }

  return undefined;
}

/**
 * Resolve a 0-based generated position inside a parsed map. Flat maps do the classic per-line
 * segment binary search; sectioned (index) maps select the last section starting at or before the
 * position, shift the position into the section's coordinate space, and recurse into its sub-map.
 */
function resolveInParsedMap(map: ParsedSourceMap, line0: number, column0: number): OriginalPosition | undefined {
  if (map.kind === "flat") {
    const segments = map.segmentsByLine.get(line0);
    if (segments == null || segments.length === 0) {
      return undefined;
    }
    const segment = findSegment(segments, column0) ?? segments[0];
    const source = map.sources[segment.sourceIndex];
    if (source == null) {
      return undefined;
    }
    const resolvedSource = resolveSourcePath(source, map.sourceRoot, map.mapDir);
    return { source: resolvedSource, line: segment.origLine + 1, column: segment.origColumn + 1 };
  }

  // Sections are ordered by increasing offset; pick the last one starting at or before the position.
  let selected: ParsedSection | undefined;
  for (const section of map.sections) {
    if (line0 > section.offsetLine || (line0 === section.offsetLine && column0 >= section.offsetColumn)) {
      selected = section;
    } else {
      break;
    }
  }
  if (selected?.map == null) {
    return undefined;
  }
  const relLine0 = line0 - selected.offsetLine;
  const relColumn0 = line0 === selected.offsetLine ? Math.max(0, column0 - selected.offsetColumn) : column0;
  return resolveInParsedMap(selected.map, relLine0, relColumn0);
}

/** Matches a URL-scheme prefix (`webpack://`, `webpack-internal://`, `file://`, ...) on a `sources` entry. */
const SOURCE_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turn a raw `sources` entry into a usable path. Per the source-map spec, `sources` are relative to
 * `sourceRoot` and then to the map's own location — reporting them verbatim would show `../src/app.ts`
 * for a map in `dist/`, which neither cwd-relativizes nor opens in an editor. So: apply `sourceRoot`,
 * strip a `file://` prefix, reduce bundler-virtual schemes (`webpack://_N_E/./src/x.ts` and friends) to
 * their project-relative tail (the virtual path has no on-disk anchor, so the readable tail is the best
 * available), and anchor plain relative paths to `mapDir` so `dist/app.js.map` + `../src/app.ts` yields
 * the real on-disk `src/app.ts`.
 *
 * Bracket-prefixed virtual sources from modern bundlers (Turbopack's `[project]/src/app.ts`) get the
 * same tail treatment as scheme-prefixed ones, so they come out as the clean `src/app.ts` users
 * expect in logs.
 */
function resolveSourcePath(source: string, sourceRoot: string, mapDir: string): string {
  const combined = sourceRoot.length > 0 ? joinPath(sourceRoot, source) : source;

  if (combined.startsWith("file://")) {
    const stripped = normalizeFilePath(combined.replace(/^file:\/\//, ""));
    return stripped.length > 0 ? stripped : combined;
  }

  // Bundler-virtual bracket prefix (Turbopack `[project]/src/x.ts`, `[root of the server]/...`):
  // like the scheme case below, the path is project-root-relative with no on-disk anchor at the
  // map's location, so report the readable tail instead of wrongly anchoring it to `mapDir`.
  const bracketMatch = combined.match(/^\[[^\]]+\]\/(.+)$/);
  if (bracketMatch?.[1]) {
    const cleaned = normalizeFilePath(bracketMatch[1]);
    /* v8 ignore next -- defensive: `(.+)` guarantees a non-empty tail; normalizeFilePath collapses to empty only for degenerate inputs like "./" */
    return cleaned.length > 0 ? cleaned : combined;
  }

  const scheme = combined.match(SOURCE_SCHEME_REGEX);
  if (scheme != null) {
    // Bundler-virtual path: drop the scheme and the namespace segment (e.g. webpack://_N_E/./src/x.ts).
    // For virtual sources we prefer the cleaned project-relative tail over joining to the map dir.
    const rest = combined.slice(scheme[0].length);
    const slash = rest.indexOf("/");
    const tail = slash === -1 ? rest : rest.slice(slash + 1);
    const cleaned = normalizeFilePath(tail);
    if (cleaned.length > 0) {
      return cleaned;
    }
    return combined; // fall back to the (still virtual) original for degenerate cases
  }

  if (/^([A-Za-z]:)?[/\\]/.test(combined)) {
    return combined;
  }

  // normalizeFilePath already falls back to its input when normalization collapses to empty, and
  // joinPath(mapDir, combined) always produces a non-empty string, so no empty-check is needed here.
  return normalizeFilePath(joinPath(mapDir, combined));
}

/** Find the mapping segment on `genLine` at or immediately before `genColumn` (source maps snap to segment start). */
function findSegment(segments: MappingSegment[], genColumn: number): MappingSegment | undefined {
  // Binary search: segments are sorted by genColumn (parseMappings sorts on insertion). A linear scan
  // would be O(n) per frame, and a single bundled output line can carry hundreds of segments.
  let lo = 0;
  let hi = segments.length - 1;
  let candidate: MappingSegment | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const segment = segments[mid];
    if (segment.genColumn <= genColumn) {
      candidate = segment;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
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

  const zeroBasedColumn = Number.isFinite(column) && column >= 1 ? column - 1 : 0;
  return resolveInParsedMap(map, line - 1, zeroBasedColumn);
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
 * Build the {@link SourceMapResolver} the node/universal providers inject into `providerBase`. The
 * resolver itself decides per call whether resolution is enabled (production default off, or
 * `TSLOG_SOURCE_MAPS=off`) and returns `undefined` when it is not, so the caller keeps the transpiled
 * position.
 *
 * The enablement check (`sourceMapResolutionEnabled`) is evaluated **per call**, not frozen at logger
 * construction. This means flipping `TSLOG_SOURCE_MAPS` or `NODE_ENV` at runtime takes effect
 * immediately — important for tests that toggle the flag between cases without recreating the logger.
 * The cost is a single env-var read per stack frame, negligible behind the parsed-map cache.
 */
export function createSourceMapResolver(): SourceMapResolver | undefined {
  return (filePath, line, column) => {
    if (!sourceMapResolutionEnabled()) {
      return undefined;
    }
    return resolveOriginalPosition(filePath, line, column);
  };
}
