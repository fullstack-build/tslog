import { Logger } from "../src/index.js";
import type { IMeta, LogContext } from "../src/interfaces.js";

/**
 * M2a migration: the v4 `overwrite.addMeta` hook (and its `includeDefaultMetaInAddMeta` flag, which fed
 * the default meta to the hook as a 4th argument so it could *extend* rather than *replace* it) was
 * removed (M2.6). Its replacement is `logger.use(...)` middleware: a middleware reads the level off the
 * `LogContext` and stashes fields on `ctx.meta`, which the core merges onto the finished record's `_meta`
 * block — i.e. it extends the default meta instead of rebuilding it. These tests verify that replacement.
 */
describe("meta enrichment via middleware (replaces overwrite.addMeta)", () => {
  test("middleware sees the level on the context and its meta is merged onto the default _meta", () => {
    let context: LogContext<unknown> | undefined;
    const logger = new Logger({
      type: "hidden",
      name: "MetaLogger",
    });

    logger.use((ctx) => {
      context = ctx;
      // Extend the default meta rather than replace it: the stashed field is merged onto _meta by the core.
      ctx.meta.custom = "added";
      return ctx;
    });

    const out = logger.info("hello") as unknown as { _meta: IMeta & { custom?: string } };

    // The level the old hook received as the 2nd/3rd args is now on the LogContext.
    expect(context).toBeDefined();
    expect(context?.logLevelId).toBe(3);
    expect(context?.logLevelName).toBe("INFO");

    // The default meta the old `includeDefaultMetaInAddMeta` flag exposed is just the finished record's
    // _meta now: it carries the resolved level, the logger name, and the runtime.
    expect(out._meta.logLevelId).toBe(3);
    expect(out._meta.logLevelName).toBe("INFO");
    expect(out._meta.name).toBe("MetaLogger");
    expect(out._meta.runtime).toBeDefined();

    // The middleware's extension is preserved alongside the default meta (extend, not replace).
    expect(out._meta.custom).toBe("added");
  });

  test("a middleware that stashes nothing leaves the default meta intact", () => {
    let ran = false;
    const logger = new Logger({ type: "hidden" });

    logger.use((ctx) => {
      ran = true;
      // Stash nothing on ctx.meta.
      return ctx;
    });

    const out = logger.warn("x") as unknown as { _meta: IMeta };

    expect(ran).toBe(true);
    // No custom keys leaked onto _meta; the default meta is present and untouched.
    expect((out._meta as IMeta & { custom?: unknown }).custom).toBeUndefined();
    expect(out._meta.logLevelName).toBe("WARN");
    expect(out._meta.logLevelId).toBe(4);
  });
});
