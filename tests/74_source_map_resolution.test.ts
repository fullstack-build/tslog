import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeEnvironment } from "../src/env/environment.node.js";
import { parseServerStackLine } from "../src/env/shared.js";
import { clearSourceMapCacheForTests, createSourceMapResolver, resolveOriginalPosition, sourceMapResolutionEnabled } from "../src/env/sourceMap.node.js";

// Source-map resolution (issue #307): transpiled/bundled frames (`dist/app.js:2:11`) are remapped to
// their original source position (`app.ts:2:9`) via a hand-rolled source-map v3 consumer (no runtime
// deps allowed). These tests build REAL fixture files + real mappings strings on disk rather than
// mocking node:fs, so a VLQ-decoding bug would actually surface.

// A hand-computed mappings string for the trivial case: generated line 2 col 10 -> original line 2 col 8.
// Segment format is [genColumn, sourceIndex, origLine, origColumn] VLQ-encoded, comma-joined per line,
// semicolon-joined across generated lines. Line 1 (index 0) is empty (no mapping); line 2 (index 1) has
// one segment at genColumn 10 pointing to origLine 1 (0-based) col 8: [20,0,2,16] in VLQ.
// Field deltas from (0,0,0,0): genColumn=10 -> 20 ("U"), sourceIndex=0 -> "A", origLine=1 -> 2 ("C"), origColumn=8 -> 16 ("Q").
const SIMPLE_MAPPINGS = ";UACQ";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tslog-sourcemap-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("source-map resolution (issue #307)", () => {
  beforeEach(() => {
    clearSourceMapCacheForTests();
  });

  test("resolves a generated position to its original source via an external .map file", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "app.js");
      const mapPath = join(dir, "app.js.map");
      await writeFile(jsPath, "line one\nline two is longer\n//# sourceMappingURL=app.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["app.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: join(dir, "app.ts"), line: 2, column: 9 });
    });
  });

  test("resolves via an inline base64 data-URL source map", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "inline.js");
      const map = { version: 3, sources: ["inline.ts"], names: [], mappings: SIMPLE_MAPPINGS };
      const base64 = Buffer.from(JSON.stringify(map)).toString("base64");
      await writeFile(jsPath, `line one\nline two\n//# sourceMappingURL=data:application/json;base64,${base64}\n`);

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: join(dir, "inline.ts"), line: 2, column: 9 });
    });
  });

  test("returns undefined when the file has no sourceMappingURL comment", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "plain.js");
      await writeFile(jsPath, "console.log('no map here');\n");
      expect(resolveOriginalPosition(jsPath, 1, 1)).toBeUndefined();
    });
  });

  test("returns undefined when the referenced .map file does not exist", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "dangling.js");
      await writeFile(jsPath, "line one\n//# sourceMappingURL=missing.js.map\n");
      expect(resolveOriginalPosition(jsPath, 1, 1)).toBeUndefined();
    });
  });

  test("returns undefined for a malformed (non-JSON) map file", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "bad.js");
      const mapPath = join(dir, "bad.js.map");
      await writeFile(jsPath, "line one\n//# sourceMappingURL=bad.js.map\n");
      await writeFile(mapPath, "not json{{{");
      expect(resolveOriginalPosition(jsPath, 1, 1)).toBeUndefined();
    });
  });

  test("returns undefined for a file that does not exist on disk", () => {
    expect(resolveOriginalPosition("/no/such/file/anywhere.js", 1, 1)).toBeUndefined();
  });

  test("returns undefined when the requested line has no covering segment", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "sparse.js");
      const mapPath = join(dir, "sparse.js.map");
      await writeFile(jsPath, "line one\nline two\nline three\n//# sourceMappingURL=sparse.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["sparse.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      // Line 3 (index 2) has no mapping segment in SIMPLE_MAPPINGS.
      expect(resolveOriginalPosition(jsPath, 3, 1)).toBeUndefined();
    });
  });

  test("prepends sourceRoot to the resolved source when present", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "rooted.js");
      const mapPath = join(dir, "rooted.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=rooted.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sourceRoot: "src", sources: ["rooted.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe(join(dir, "src/rooted.ts"));
    });
  });

  test("anchors a parent-relative source (../src) to the map's directory, not reported verbatim", async () => {
    await withTempDir(async (dir) => {
      // tsc-style layout: dist/app.js + dist/app.js.map whose sources point back out to ../src/app.ts.
      await mkdir(join(dir, "dist"));
      const jsPath = join(dir, "dist", "traverse.js");
      const mapPath = join(dir, "dist", "traverse.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=traverse.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["../src/traverse.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe(join(dir, "src/traverse.ts"));
    });
  });

  test("reduces a webpack:// virtual source to its project-relative tail", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "bundle.js");
      const mapPath = join(dir, "bundle.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=bundle.js.map\n");
      // Next.js/webpack shape: scheme + namespace + ./-prefixed project path. No on-disk anchor exists,
      // so the readable tail is the best available.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["webpack://_N_E/./src/page.tsx"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("src/page.tsx");
    });
  });

  test("strips a file:// prefix from an absolute source entry", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "fileurl.js");
      const mapPath = join(dir, "fileurl.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=fileurl.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["file:///abs/original.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("/abs/original.ts");
    });
  });

  test("returns the raw file:// source verbatim when the path after stripping is empty", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "emptyfile.js");
      const mapPath = join(dir, "emptyfile.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=emptyfile.js.map\n");
      // "file://" with no path after the scheme — normalizeFilePath collapses to empty, so the
      // resolveSourcePath fallback returns the original combined string verbatim.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["file://"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("file://");
    });
  });

  test("reduces a webpack:// virtual source with no path after the namespace to the namespace itself", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "nopath.js");
      const mapPath = join(dir, "nopath.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=nopath.js.map\n");
      // "webpack://_N_E" has no slash after the namespace — the tail is the namespace itself.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["webpack://_N_E"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("_N_E");
    });
  });

  test("returns a webpack:// virtual source verbatim when the tail after the namespace slash is empty", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "emptytail.js");
      const mapPath = join(dir, "emptytail.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=emptytail.js.map\n");
      // "webpack://_N_E/" — the tail after the slash is empty, normalizeFilePath returns empty,
      // so the fallback returns the original combined string verbatim.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["webpack://_N_E/"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("webpack://_N_E/");
    });
  });

  test("caches the parsed map: a second resolution against the same file does not re-read it", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "cached.js");
      const mapPath = join(dir, "cached.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=cached.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["cached.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const first = resolveOriginalPosition(jsPath, 2, 11);
      // Deleting the underlying file proves a second lookup is served from cache, not re-read from disk.
      await rm(jsPath);
      const second = resolveOriginalPosition(jsPath, 2, 11);
      expect(first).toEqual(second);
    });
  });

  test("parsed-map cache evicts the oldest entry when the 256-entry cap is reached", async () => {
    await withTempDir(async (dir) => {
      // Create one real file with a source map.
      const jsPath = join(dir, "real.js");
      const mapPath = join(dir, "real.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=real.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["real.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      // Resolve it — caches the parsed map (entry 1 in the cache).
      const firstResolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(firstResolved).toEqual({ source: join(dir, "real.ts"), line: 2, column: 9 });

      // Fill the cache with 256 non-existent file paths (each cached as null). The 256th addition
      // triggers the FIFO eviction (size >= 256), evicting the oldest entry (real.js).
      for (let i = 0; i < 256; i++) {
        resolveOriginalPosition(join(dir, `nonexistent-${i}.js`), 1, 1);
      }

      // The real.js entry should have been evicted. Delete the underlying file and resolve again —
      // if evicted, it re-reads from disk, fails, and returns undefined. If still cached, it would
      // return the cached parsed map (not undefined).
      await rm(jsPath);
      const reResolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(reResolved).toBeUndefined();
    });
  });

  test("returns undefined for a non-finite or out-of-range line", () => {
    expect(resolveOriginalPosition("/tmp/whatever.js", Number.NaN, 1)).toBeUndefined();
    expect(resolveOriginalPosition("/tmp/whatever.js", 0, 1)).toBeUndefined();
  });

  test("decodes a multi-character (continuation-bit) VLQ value for a large column delta", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "wide.js");
      const mapPath = join(dir, "wide.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=wide.js.map\n");
      // "oG" VLQ-decodes to a single field of 100 (needs the continuation bit -- single VLQ chars only
      // reach +/-15). Used as the sole field is invalid (needs 4 fields), so pair it with 3 more.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["wide.ts"], names: [], mappings: ";oGAAA" }));

      const resolved = resolveOriginalPosition(jsPath, 2, 101);
      expect(resolved).toEqual({ source: join(dir, "wide.ts"), line: 1, column: 1 });
    });
  });

  test("skips a malformed segment (fewer than 4 fields) and an empty comma-separated entry", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "malformed.js");
      const mapPath = join(dir, "malformed.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=malformed.js.map\n");
      // "AA" decodes to only 2 fields (invalid, skipped); the empty entry between commas is also
      // skipped; "UACQ" is the well-formed segment from SIMPLE_MAPPINGS and should still resolve.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["malformed.ts"], names: [], mappings: ";AA,,UACQ" }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: join(dir, "malformed.ts"), line: 2, column: 9 });
    });
  });

  test("findSegment stops scanning once a later segment's column exceeds the requested column", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "multi.js");
      const mapPath = join(dir, "multi.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=multi.js.map\n");
      // Two segments on generated line 2: genColumn 0 -> orig (0,0); genColumn 20 -> orig (0,2).
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["multi.ts"], names: [], mappings: ";AAAA,oBAAE" }));

      // Requesting 0-based column 5 sits between the two segments: the scan takes segment 1 as the
      // candidate, then breaks on segment 2 (genColumn 20 > 5) instead of overwriting the candidate.
      const resolved = resolveOriginalPosition(jsPath, 2, 6);
      expect(resolved).toEqual({ source: join(dir, "multi.ts"), line: 1, column: 1 });
    });
  });

  test("findSegment binary-searches a line with many segments and finds the nearest preceding one", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "dense.js");
      const mapPath = join(dir, "dense.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=dense.js.map\n");
      // Five segments on generated line 2 at genColumns 0, 10, 20, 30, 40, each mapping to
      // origLine 1 (0-based) with origColumns 0, 1, 2, 3, 4 respectively.
      // VLQ deltas for each segment (genColumn is cumulative within a line; the other fields too):
      //   seg1: genCol +0 ("A"), src +0 ("A"), origLine +0 ("A"), origCol +0 ("A")  -> "AAAA"
      //   seg2: genCol +10 ("U"), src +0 ("A"), origLine +0 ("A"), origCol +1 ("C")  -> "UAAC"
      //   seg3: genCol +10 ("U"), src +0 ("A"), origLine +0 ("A"), origCol +1 ("C")  -> "UAAC"
      //   seg4: genCol +10 ("U"), src +0 ("A"), origLine +0 ("A"), origCol +1 ("C")  -> "UAAC"
      //   seg5: genCol +10 ("U"), src +0 ("A"), origLine +0 ("A"), origCol +1 ("C")  -> "UAAC"
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["dense.ts"], names: [], mappings: ";AAAA,UAAC,UAAC,UAAC,UAAC" }));

      // Column 25 (1-based, so 0-based 24) sits between segments at genColumn 20 and 30 — the
      // binary search must land on the genColumn 20 segment (origColumn 2, 1-based 3), not the
      // genColumn 30 one or any earlier one.
      expect(resolveOriginalPosition(jsPath, 2, 25)).toEqual({ source: join(dir, "dense.ts"), line: 1, column: 3 });

      // Column 5 (0-based 4) is before the genColumn 10 segment, so it falls back to segments[0]
      // (genColumn 0 -> origColumn 0, 1-based 1).
      expect(resolveOriginalPosition(jsPath, 2, 5)).toEqual({ source: join(dir, "dense.ts"), line: 1, column: 1 });

      // Column 45 (0-based 44) is at/after the last segment (genColumn 40 -> origColumn 4, 1-based 5).
      expect(resolveOriginalPosition(jsPath, 2, 45)).toEqual({ source: join(dir, "dense.ts"), line: 1, column: 5 });
    });
  });

  test("returns undefined when the resolved sourceIndex has no corresponding entry in sources", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "oob.js");
      const mapPath = join(dir, "oob.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=oob.js.map\n");
      // The segment's sourceIndex delta is 1, but sources has only one entry (index 0) -> sources[1] is undefined.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["only.ts"], names: [], mappings: ";ACAA" }));

      expect(resolveOriginalPosition(jsPath, 2, 1)).toBeUndefined();
    });
  });

  test("ignores a non-Base64-VLQ character embedded in a segment", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "junk.js");
      const mapPath = join(dir, "junk.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=junk.js.map\n");
      // "U!ACQ" has a stray "!" (not in the Base64-VLQ alphabet) spliced into the otherwise-valid
      // "UACQ" segment; decodeVlq skips unknown characters rather than treating them as data.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["junk.ts"], names: [], mappings: ";U!ACQ" }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: join(dir, "junk.ts"), line: 2, column: 9 });
    });
  });

  test("uses an already-absolute source as-is instead of joining it onto sourceRoot", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "absroot.js");
      const mapPath = join(dir, "absroot.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=absroot.js.map\n");
      await writeFile(
        mapPath,
        JSON.stringify({ version: 3, sourceRoot: "/abs/root", sources: ["/elsewhere/absroot.ts"], names: [], mappings: SIMPLE_MAPPINGS }),
      );

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe("/elsewhere/absroot.ts");
    });
  });

  test("decodes a negative VLQ delta (the sign bit)", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "negative.js");
      const mapPath = join(dir, "negative.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=negative.js.map\n");
      // "UACF" decodes to [genColumn=10, sourceIndex=0, origLine=1, origColumn=-2] -- a negative
      // origColumn delta, exercising decodeVlq's sign-bit branch.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["negative.ts"], names: [], mappings: ";UACF" }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: join(dir, "negative.ts"), line: 2, column: -1 });
    });
  });

  test("a second lookup against a file with no map is served from the null-cache entry", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "nomap.js");
      await writeFile(jsPath, "console.log('no map');\n");

      const first = resolveOriginalPosition(jsPath, 1, 1);
      const second = resolveOriginalPosition(jsPath, 1, 1);
      expect(first).toBeUndefined();
      expect(second).toBeUndefined();
    });
  });

  test("treats a file path with no directory separator as having no directory", async () => {
    // dirnameOf's "." fallback only runs once the file has actually been read and a sourceMappingURL
    // found, so this needs a real file at a bare (separator-free) relative path -- resolved against
    // process.cwd() by fs.readFileSync, same as a real "at bare-filename.js:1:1" V8 frame would be.
    const bareName = "tslog-sourcemap-bare-test.js";
    const mapName = "tslog-sourcemap-bare-test.js.map";
    await writeFile(bareName, `line one\n//# sourceMappingURL=${mapName}\n`);
    await writeFile(mapName, JSON.stringify({ version: 3, sources: ["bare.ts"], names: [], mappings: "AAAA" }));
    try {
      expect(resolveOriginalPosition(bareName, 1, 1)).toEqual({ source: "bare.ts", line: 1, column: 1 });
    } finally {
      await rm(bareName, { force: true });
      await rm(mapName, { force: true });
    }
  });

  test("falls back to column 0 when the requested column is non-finite or below 1", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "nocolumn.js");
      const mapPath = join(dir, "nocolumn.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=nocolumn.js.map\n");
      // A segment at genColumn 0 so the zero-based fallback (column 0) still finds it.
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["nocolumn.ts"], names: [], mappings: ";AAAA" }));

      expect(resolveOriginalPosition(jsPath, 2, Number.NaN)).toEqual({ source: join(dir, "nocolumn.ts"), line: 1, column: 1 });
      expect(resolveOriginalPosition(jsPath, 2, 0)).toEqual({ source: join(dir, "nocolumn.ts"), line: 1, column: 1 });
    });
  });

  test("falls back to the line's first segment when the requested column is before every segment", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "beforefirst.js");
      const mapPath = join(dir, "beforefirst.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=beforefirst.js.map\n");
      // The line's only segment starts at genColumn 5; requesting column 1 (0-based 0) is before it,
      // so findSegment returns undefined and resolveOriginalPosition falls back to segments[0].
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["beforefirst.ts"], names: [], mappings: ";KAAA" }));

      const resolved = resolveOriginalPosition(jsPath, 2, 1);
      expect(resolved).toEqual({ source: join(dir, "beforefirst.ts"), line: 1, column: 1 });
    });
  });

  test("returns undefined for a data: sourceMappingURL without a base64 marker", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "nobase64.js");
      await writeFile(jsPath, "line one\n//# sourceMappingURL=data:application/json,{}\n");
      expect(resolveOriginalPosition(jsPath, 1, 1)).toBeUndefined();
    });
  });

  test("createSourceMapResolver returns a resolver that returns undefined per-call when disabled", () => {
    const original = process.env.TSLOG_SOURCE_MAPS;
    try {
      process.env.TSLOG_SOURCE_MAPS = "off";
      // Per-call check: the resolver function is always returned, but it returns undefined
      // when sourceMapResolutionEnabled() is false at call time.
      const resolver = createSourceMapResolver();
      expect(resolver).toBeDefined();
      expect(resolver?.("/some/file.js", 1, 1)).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.TSLOG_SOURCE_MAPS;
      } else {
        process.env.TSLOG_SOURCE_MAPS = original;
      }
    }
  });

  test("createSourceMapResolver per-call check: toggling TSLOG_SOURCE_MAPS takes effect without recreating the resolver", async () => {
    const original = process.env.TSLOG_SOURCE_MAPS;
    try {
      await withTempDir(async (dir) => {
        const jsPath = join(dir, "toggle.js");
        const mapPath = join(dir, "toggle.js.map");
        await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=toggle.js.map\n");
        await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["toggle.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

        // Create the resolver once while enabled.
        process.env.TSLOG_SOURCE_MAPS = "on";
        const resolver = createSourceMapResolver();
        expect(resolver?.(jsPath, 2, 11)).toEqual({ source: join(dir, "toggle.ts"), line: 2, column: 9 });

        // Flip to off — the same resolver instance should now return undefined per-call.
        process.env.TSLOG_SOURCE_MAPS = "off";
        expect(resolver?.(jsPath, 2, 11)).toBeUndefined();

        // Flip back on — resolution resumes without recreating the resolver.
        process.env.TSLOG_SOURCE_MAPS = "on";
        expect(resolver?.(jsPath, 2, 11)).toEqual({ source: join(dir, "toggle.ts"), line: 2, column: 9 });
      });
    } finally {
      if (original === undefined) {
        delete process.env.TSLOG_SOURCE_MAPS;
      } else {
        process.env.TSLOG_SOURCE_MAPS = original;
      }
    }
  });

  test("createSourceMapResolver returns a working resolver function when enabled", async () => {
    const original = process.env.TSLOG_SOURCE_MAPS;
    process.env.TSLOG_SOURCE_MAPS = "on";
    try {
      await withTempDir(async (dir) => {
        const jsPath = join(dir, "factory.js");
        const mapPath = join(dir, "factory.js.map");
        await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=factory.js.map\n");
        await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["factory.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

        const resolver = createSourceMapResolver();
        expect(resolver?.(jsPath, 2, 11)).toEqual({ source: join(dir, "factory.ts"), line: 2, column: 9 });
      });
    } finally {
      if (original === undefined) {
        delete process.env.TSLOG_SOURCE_MAPS;
      } else {
        process.env.TSLOG_SOURCE_MAPS = original;
      }
    }
  });

  test("parseServerStackLine remaps a frame's position when resolveSourceMap resolves it", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "remap.js");
      const mapPath = join(dir, "remap.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=remap.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["remap.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const frame = parseServerStackLine(
        `    at boom (${jsPath}:2:11)`,
        () => undefined,
        (filePath, line, column) => resolveOriginalPosition(filePath, line, column),
      );

      expect(frame?.fileLine).toBe("2");
      expect(frame?.fileColumn).toBe("9");
      expect(frame?.filePath).toBe(join(dir, "remap.ts"));
      expect(frame?.fileName).toBe("remap.ts");
      expect(frame?.filePathWithLine).toBe(`${join(dir, "remap.ts")}:2`);
      // Fix 1: fullFilePath should be consistent with the remapped position, not the transpiled one.
      expect(frame?.fullFilePath).toBe(`${join(dir, "remap.ts")}:2:9`);
    });
  });

  test("fullFilePath stays absolute after a remap even when filePath is cwd-relativized", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "cwdrel.js");
      const mapPath = join(dir, "cwdrel.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=cwdrel.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["cwdrel.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      // getCwd returns the tempdir, so the remapped source sits under cwd: filePath must relativize,
      // fullFilePath must keep the absolute resolver output (the field's "full path" contract).
      const frame = parseServerStackLine(
        `    at boom (${jsPath}:2:11)`,
        () => dir,
        (filePath, line, column) => resolveOriginalPosition(filePath, line, column),
      );

      expect(frame?.filePath).toBe("cwdrel.ts");
      expect(frame?.fullFilePath).toBe(`${join(dir, "cwdrel.ts")}:2:9`);
    });
  });

  test("parseServerStackLine preserves the transpiled fullFilePath when no remap occurs", () => {
    const frame = parseServerStackLine(
      "    at boom (/no/map/here.js:5:3)",
      () => undefined,
      () => undefined,
    );
    expect(frame?.fullFilePath).toBe("/no/map/here.js:5:3");
  });

  test("resolveSourcePath anchors a relative source to the map's directory for nested layouts", async () => {
    await withTempDir(async (dir) => {
      // Nested layout: dist/deep/app.js + dist/deep/app.js.map whose sources point to "src/app.ts"
      // (relative to the map file, not to the project root). The resolved path should be
      // dist/deep/src/app.ts — anchored to the map's directory, not reported verbatim.
      await mkdir(join(dir, "dist", "deep"), { recursive: true });
      const jsPath = join(dir, "dist", "deep", "nested.js");
      const mapPath = join(dir, "dist", "deep", "nested.js.map");
      await writeFile(jsPath, "line one\nline two\n//# sourceMappingURL=nested.js.map\n");
      await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["src/nested.ts"], names: [], mappings: SIMPLE_MAPPINGS }));

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved?.source).toBe(join(dir, "dist", "deep", "src", "nested.ts"));
    });
  });

  test("parseServerStackLine keeps the transpiled position when resolveSourceMap returns undefined", () => {
    const frame = parseServerStackLine(
      "    at boom (/no/map/here.js:5:3)",
      () => undefined,
      () => undefined,
    );
    expect(frame?.fileLine).toBe("5");
    expect(frame?.fileColumn).toBe("3");
    expect(frame?.filePath).toBe("/no/map/here.js");
  });

  test("parseServerStackLine behaves identically to omitting resolveSourceMap when it is not supplied", () => {
    const withoutResolver = parseServerStackLine("    at boom (/no/map/here.js:5:3)", () => undefined);
    expect(withoutResolver?.fileLine).toBe("5");
    expect(withoutResolver?.filePath).toBe("/no/map/here.js");
  });

  test("sourceMapResolutionEnabled respects TSLOG_SOURCE_MAPS override regardless of NODE_ENV", () => {
    const originalOverride = process.env.TSLOG_SOURCE_MAPS;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.TSLOG_SOURCE_MAPS = "on";
      expect(sourceMapResolutionEnabled()).toBe(true);

      process.env.NODE_ENV = "development";
      process.env.TSLOG_SOURCE_MAPS = "off";
      expect(sourceMapResolutionEnabled()).toBe(false);
    } finally {
      if (originalOverride === undefined) {
        delete process.env.TSLOG_SOURCE_MAPS;
      } else {
        process.env.TSLOG_SOURCE_MAPS = originalOverride;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  test("sourceMapResolutionEnabled defaults to NODE_ENV when no override is set", () => {
    const originalOverride = process.env.TSLOG_SOURCE_MAPS;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.TSLOG_SOURCE_MAPS;
      process.env.NODE_ENV = "production";
      expect(sourceMapResolutionEnabled()).toBe(false);

      process.env.NODE_ENV = "development";
      expect(sourceMapResolutionEnabled()).toBe(true);
    } finally {
      if (originalOverride === undefined) {
        delete process.env.TSLOG_SOURCE_MAPS;
      } else {
        process.env.TSLOG_SOURCE_MAPS = originalOverride;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  test("end-to-end: a Node logger resolves a compiled TS error frame back to its original .ts position", async () => {
    await withTempDir(async (dir) => {
      const originalOverride = process.env.TSLOG_SOURCE_MAPS;
      process.env.TSLOG_SOURCE_MAPS = "on";
      try {
        // Hand-compiled equivalent of:
        //   export function boom(): void {   <- line 1
        //     throw new Error("boom");        <- line 2
        //   }
        const jsPath = join(dir, "boom.js");
        const mapPath = join(dir, "boom.js.map");
        await writeFile(jsPath, 'export function boom() {\n    throw new Error("boom");\n}\n//# sourceMappingURL=boom.js.map\n');
        // genLine 2 (index 1), genColumn 10 ("throw" body start) -> origLine 2 (index 1), origColumn 4.
        await writeFile(mapPath, JSON.stringify({ version: 3, sources: ["boom.ts"], names: [], mappings: ";UACI" }));

        const runtime = createNodeEnvironment();
        const error = new Error("boom");
        error.stack = `Error: boom\n    at boom (${jsPath}:2:11)\n    at caller (${jsPath}:5:5)`;

        const frame = runtime.getCallerStackFrame(0, error);
        expect(frame.filePath).toBe(join(dir, "boom.ts"));
        expect(frame.fileLine).toBe("2");
      } finally {
        if (originalOverride === undefined) {
          delete process.env.TSLOG_SOURCE_MAPS;
        } else {
          process.env.TSLOG_SOURCE_MAPS = originalOverride;
        }
      }
    });
  });
});
