// stdoutSink.node.ts drainSync when node:fs offers no usable writeSync. `createRequire` is a static
// named import from node:module, so it (unlike the require() call it produces) IS interceptable —
// mock it here, in a DEDICATED file (fresh module registry), BEFORE importing the sink, so drainSync
// takes the "fsWriteSync == null → stream fallback" path instead of the fs.writeSync loop.

const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

// A require whose "node:fs" has no writeSync function → the sink resolves fsWriteSync to null.
vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => ((id: string) => (id === "node:fs" ? { writeSync: undefined } : {})) as unknown as NodeJS.Require,
  };
});

describe.runIf(isNode)("stdoutSink: drainSync stream fallback when fs.writeSync is unavailable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("drainSync writes the whole buffer via the stream when node:fs has no writeSync", async () => {
    const captured: string[] = [];
    const stdout = {
      write(chunk: string, cb?: () => void): boolean {
        captured.push(chunk);
        cb?.();
        return true;
      },
      on(): void {
        // no-op error guard target
      },
    };
    let exitListener: ((...args: unknown[]) => void) | undefined;
    vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "exit") {
        exitListener = listener;
      }
      return process;
    }) as never);
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { getStdoutJsonSink } = await import("../src/env/stdoutSink.node.js");
      const sink = getStdoutJsonSink();
      sink.write('{"m":"no-writesync"}');
      // The exit drain resolves fsWriteSync -> null (writeSync isn't a function), so the whole chunk
      // goes to the stream fallback rather than the byte-loop.
      exitListener?.(0);
      expect(captured.join("")).toContain('"no-writesync"');
      expect(captured.join("").endsWith("\n")).toBe(true);
    } finally {
      getter.mockRestore();
    }
  });
});
