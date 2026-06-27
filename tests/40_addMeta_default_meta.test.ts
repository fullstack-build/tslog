import { Logger } from "../src/index.js";
import type { IMeta } from "../src/interfaces.js";

describe("overwrite.addMeta with includeDefaultMetaInAddMeta", () => {
  test("receives the default meta as the 4th argument when the flag is enabled", () => {
    let received: IMeta | undefined;
    const logger = new Logger({
      type: "hidden",
      name: "MetaLogger",
      overwrite: {
        includeDefaultMetaInAddMeta: true,
        addMeta: (logObj, logLevelId, logLevelName, defaultMeta) => {
          received = defaultMeta;
          // Extend the default meta rather than replace it.
          return { ...logObj, _meta: { ...(defaultMeta as IMeta), custom: "added" } } as never;
        },
      },
    });

    const out = logger.info("hello") as unknown as { _meta: IMeta & { custom?: string } };

    expect(received).toBeDefined();
    expect(received?.logLevelId).toBe(3);
    expect(received?.logLevelName).toBe("INFO");
    expect(received?.name).toBe("MetaLogger");
    expect(received?.runtime).toBeDefined();
    // The handler's extension is preserved alongside the default meta.
    expect(out._meta.custom).toBe("added");
    expect(out._meta.logLevelName).toBe("INFO");
  });

  test("default meta is undefined when the flag is off (backward compatible)", () => {
    let received: IMeta | undefined | "untouched" = "untouched";
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        addMeta: (logObj, _id, _name, defaultMeta) => {
          received = defaultMeta;
          return { ...logObj, _meta: { customOnly: true } } as never;
        },
      },
    });

    logger.warn("x");
    expect(received).toBeUndefined();
  });
});
