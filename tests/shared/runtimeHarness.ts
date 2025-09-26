import type { IMeta, IStackFrame } from "../../src/interfaces.js";
import { findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "../../src/internal/stackTrace.js";

type AsyncOrSync<T> = T | Promise<T>;

type RuntimeMethods = {
  getMeta: (
    logLevelId: number,
    logLevelName: string,
    stackDepthLevel: number,
    hideLogPositionForPerformance: boolean,
    name?: string,
    parentNames?: string[],
  ) => AsyncOrSync<IMeta>;
  getCallerStackFrame: (stackDepthLevel: number, error: Error) => AsyncOrSync<IStackFrame>;
  getErrorTrace: (error: Error) => AsyncOrSync<IStackFrame[]>;
  resetWorkingDirectory?: () => AsyncOrSync<void>;
  dispose?: () => AsyncOrSync<void>;
};

export interface RuntimeTestOptions {
  label: string;
  expectedRuntime: string;
  create: () => AsyncOrSync<RuntimeMethods>;
  stackScenario: {
    description: string;
    errorStack: string;
    expectedFilePathWithLine: string | undefined;
    expectedAutoIndex: number;
  };
}

export function registerUniversalRuntimeTests(options: RuntimeTestOptions): void {
  describe(`logger environment (${options.label})`, () => {
    let methods: RuntimeMethods;

    beforeEach(async () => {
      methods = await options.create();
      await methods.resetWorkingDirectory?.();
    });

    afterEach(async () => {
      await methods.dispose?.();
    });

    test("reports runtime name in meta", async () => {
      const meta = await methods.getMeta(3, "INFO", Number.NaN, false);
      expect(meta.runtime).toBe(options.expectedRuntime);
      expect(meta.date).toBeInstanceOf(Date);
    });

    test(options.stackScenario.description, async () => {
      const error = { stack: options.stackScenario.errorStack } as Error;
      const frames = await methods.getErrorTrace(error);
      const autoIndex = findFirstExternalFrameIndex(frames, getDefaultIgnorePatterns());
      expect(autoIndex).toBe(options.stackScenario.expectedAutoIndex);

      const frame = await methods.getCallerStackFrame(Number.NaN, error);
      if (options.stackScenario.expectedFilePathWithLine == null) {
        expect(frame.filePathWithLine).toBeUndefined();
      } else {
        expect(frame.filePathWithLine).toBe(options.stackScenario.expectedFilePathWithLine);
      }
    });
  });
}
