import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      expect(resolved).toEqual({ source: "app.ts", line: 2, column: 9 });
    });
  });

  test("resolves via an inline base64 data-URL source map", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "inline.js");
      const map = { version: 3, sources: ["inline.ts"], names: [], mappings: SIMPLE_MAPPINGS };
      const base64 = Buffer.from(JSON.stringify(map)).toString("base64");
      await writeFile(jsPath, `line one\nline two\n//# sourceMappingURL=data:application/json;base64,${base64}\n`);

      const resolved = resolveOriginalPosition(jsPath, 2, 11);
      expect(resolved).toEqual({ source: "inline.ts", line: 2, column: 9 });
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
      expect(resolved?.source).toBe("src/rooted.ts");
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
      expect(resolved).toEqual({ source: "wide.ts", line: 1, column: 1 });
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
      expect(resolved).toEqual({ source: "malformed.ts", line: 2, column: 9 });
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
      expect(resolved).toEqual({ source: "multi.ts", line: 1, column: 1 });
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
      expect(resolved).toEqual({ source: "junk.ts", line: 2, column: 9 });
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
      expect(resolved).toEqual({ source: "negative.ts", line: 2, column: -1 });
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

      expect(resolveOriginalPosition(jsPath, 2, Number.NaN)).toEqual({ source: "nocolumn.ts", line: 1, column: 1 });
      expect(resolveOriginalPosition(jsPath, 2, 0)).toEqual({ source: "nocolumn.ts", line: 1, column: 1 });
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
      expect(resolved).toEqual({ source: "beforefirst.ts", line: 1, column: 1 });
    });
  });

  test("returns undefined for a data: sourceMappingURL without a base64 marker", async () => {
    await withTempDir(async (dir) => {
      const jsPath = join(dir, "nobase64.js");
      await writeFile(jsPath, "line one\n//# sourceMappingURL=data:application/json,{}\n");
      expect(resolveOriginalPosition(jsPath, 1, 1)).toBeUndefined();
    });
  });

  test("createSourceMapResolver returns undefined when resolution is disabled", () => {
    const original = process.env.TSLOG_SOURCE_MAPS;
    try {
      process.env.TSLOG_SOURCE_MAPS = "off";
      expect(createSourceMapResolver()).toBeUndefined();
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
        expect(resolver?.(jsPath, 2, 11)).toEqual({ source: "factory.ts", line: 2, column: 9 });
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
      expect(frame?.filePath).toBe("remap.ts");
      expect(frame?.fileName).toBe("remap.ts");
      expect(frame?.filePathWithLine).toBe("remap.ts:2");
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
        expect(frame.filePath).toBe("boom.ts");
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
