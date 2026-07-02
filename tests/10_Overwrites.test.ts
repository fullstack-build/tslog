import { Logger } from "../src/index.js";
import type { ILogObjMeta, IMeta, ISettings, Transport } from "../src/interfaces.js";

/**
 * v4 exposed eight `settings.overwrite.*` hooks (mask, toLogObj, addMeta,
 * includeDefaultMetaInAddMeta, addPlaceholders, formatMeta, formatLogObj,
 * transportFormatted, transportJSON). M2.6 removed that entire API and replaced it with two
 * composable mechanisms:
 *   - `logger.use((ctx) => ...)` middleware (enrich/rewrite ctx, or drop the log), and
 *   - per-transport `format` + `write(record, line)` on an attached Transport.
 *
 * This suite was the old "Overwrites" suite; it is rewritten to exercise the replacement
 * capabilities through the new API. Each block notes which removed hook it stands in for.
 */
describe("Middleware & custom transports (replaces v4 overwrite.*)", () => {
  // Replaces overwrite.mask: the old hook handed the raw args to user code before masking.
  // The replacement is a middleware, which receives the (prefix-prepended) args on ctx.args.
  test("middleware observes the log arguments (was overwrite.mask)", (): void => {
    let observed: unknown[] | undefined;
    const logger = new Logger({
      type: "hidden",
    });
    logger.use((ctx) => {
      observed = ctx.args;
      return ctx;
    });

    logger.info("string", 0, { test: 123 });

    expect(observed?.[0]).toBe("string");
    expect(observed?.[1]).toBe(0);
    expect(typeof observed?.[2]).toBe("object");
  });

  // Replaces overwrite.toLogObj: the old hook reshaped the args into the log object. Middleware
  // may rewrite ctx.args; the resulting log object is observable on the record a transport receives.
  test("middleware can rewrite the args that build the log object (was overwrite.toLogObj)", (): void => {
    let record: (Record<string, unknown> & ILogObjMeta) | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    logger.use((ctx) => {
      ctx.args = ["replaced", 1, { ok: true }];
      return ctx;
    });
    logger.attachTransport((rec) => {
      record = rec;
    });

    logger.info("string", 0, { test: 123 });

    // toLogObj buckets positional args under numeric keys; the record keeps that raw shape.
    expect(record?.["0"]).toBe("replaced");
    expect(record?.["1"]).toBe(1);
    expect(typeof record?.["2"]).toBe("object");
    expect((record?.["2"] as Record<string, unknown>)?.ok).toBe(true);
  });

  // Replaces overwrite.addMeta: the old hook let user code attach extra meta. Middleware writes
  // free-form fields to ctx.meta, which the core merges onto the record's _meta block.
  test("middleware enriches _meta (was overwrite.addMeta)", (): void => {
    let record: (Record<string, unknown> & ILogObjMeta) | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    logger.use((ctx) => {
      ctx.meta.traceId = "trace-123";
      return ctx;
    });
    logger.attachTransport((rec) => {
      record = rec;
    });

    logger.info("string", 0, { test: 123 });

    const meta = record?._meta as IMeta & { traceId?: string };
    expect(meta?.traceId).toBe("trace-123");
    expect(meta?.logLevelId).toBe(3);
    expect(meta?.logLevelName).toBe("INFO");
    // The user's args still build the record alongside the enriched meta.
    expect(record?.["0"]).toBe("string");
  });

  // Replaces overwrite.* drop semantics: middleware returning null/false drops the log entirely
  // (nothing is formatted, no transport runs, log() returns undefined).
  test("middleware can drop a log (return null)", (): void => {
    let writes = 0;
    const logger = new Logger({
      type: "hidden",
    });
    logger.use((ctx) => (ctx.logLevelId < 4 ? null : ctx));
    logger.attachTransport(() => {
      writes++;
    });

    const dropped = logger.info("below threshold");
    const kept = logger.warn("at threshold");

    expect(dropped).toBeUndefined();
    expect(kept).toBeDefined();
    expect(writes).toBe(1);
  });

  // Replaces overwrite.formatLogObj / formatMeta / transportFormatted: a per-transport
  // LogFormatter produces the line, and write(record, line) captures it. One function now covers
  // what three separate v4 hooks did.
  test("per-transport LogFormatter produces the line; write(record, line) captures it", (): void => {
    const captured: { record?: Record<string, unknown> & ILogObjMeta; line?: string; settingsType?: string } = {};
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    logger.attachTransport({
      format: (record, settings: ISettings<Record<string, unknown>>) => {
        captured.settingsType = settings.type;
        const meta = record[settings.meta.property] as unknown as IMeta;
        return `_META_${meta.logLevelName}_LOG_${record["0"]}_`;
      },
      write: (record, line) => {
        captured.record = record;
        captured.line = line;
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(captured.line).toBe("_META_INFO_LOG_string_");
    expect(captured.record?.["0"]).toBe("string");
    expect((captured.record?._meta as IMeta)?.logLevelName).toBe("INFO");
    // The formatter receives the live, resolved settings.
    expect(captured.settingsType).toBe("hidden");
  });

  // Replaces the meta argument of overwrite.transportFormatted: the record handed to write()
  // carries the full runtime meta block, including the level name.
  test("custom transport receives the record's _meta (was transportFormatted meta param)", (): void => {
    let receivedMeta: IMeta | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "pretty",
    });
    logger.attachTransport((record) => {
      receivedMeta = record._meta;
    });

    logger.warn("meta test");

    expect(receivedMeta?.logLevelName).toBe("WARN");
  });

  // Replaces the settings argument of overwrite.transportFormatted: a LogFormatter receives the
  // live settings as its second argument.
  test("LogFormatter receives settings (was transportFormatted settings param)", (): void => {
    let receivedType: string | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "pretty",
    });
    logger.attachTransport({
      format: (_record, settings) => {
        receivedType = settings.type;
        return "";
      },
      write: () => {},
    });

    logger.info("with settings");

    expect(receivedType).toBe("pretty");
  });

  // The v4 "transportFormatted backward compatible arity three" test asserted the arity-sniffing
  // behavior of the removed overwrite.transportFormatted hook. That arity-sniffing dispatch is
  // gone (M2.6) and has no replacement, so the old test is deleted. The bare-function transport
  // form that remains is covered below.
  test("a bare TransportFn still receives the finished record", (): void => {
    let record: (Record<string, unknown> & ILogObjMeta) | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    // A plain function is accepted and wrapped into a Transport with no flush.
    logger.attachTransport((rec) => {
      record = rec;
    });

    logger.info("compat test");

    expect(record?.["0"]).toBe("compat test");
    expect((record?._meta as IMeta)?.logLevelName).toBe("INFO");
  });

  // Replaces overwrite.transportJSON: a per-transport `format: "json"` yields the flat,
  // fields-first JSON line, captured via write(record, line).
  test("per-transport format json yields the flat fields-first line (was transportJSON)", (): void => {
    let line: string | undefined;
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    logger.attachTransport({
      format: "json",
      write: (_record, jsonLine) => {
        line = jsonLine;
      },
    });

    logger.info("string", 0, { test: 123 });

    const parsed = JSON.parse(line ?? "{}");
    // Flat shape: bare string under `message`, level name + numeric id at the top level,
    // remaining positional args bucketed under numeric keys, runtime meta nested under `_meta`.
    expect(parsed.message).toBe("string");
    expect(parsed.level).toBe("INFO");
    expect(parsed.levelId).toBe(3);
    expect(parsed["1"]).toBe(0);
    expect(parsed["2"]).toEqual({ test: 123 });
    expect(parsed._meta?.v).toBe(5);
    expect(parsed._meta?.logLevelId).toBe(3);
    expect(parsed._meta?.logLevelName).toBe("INFO");
  });

  // New mechanism: attachTransport returns a detach function and accepts a full Transport object
  // (with name/minLevel/format/write); settings.attachedTransports holds normalized Transport
  // objects (each has .write), no longer bare functions.
  test("attachTransport returns a detach fn; attachedTransports holds Transport objects", (): void => {
    let writes = 0;
    const logger = new Logger<Record<string, unknown>>({
      type: "hidden",
    });
    const transport: Transport<Record<string, unknown>> = {
      name: "capture",
      minLevel: "WARN",
      write: () => {
        writes++;
      },
    };
    const detach = logger.attachTransport(transport);

    // Stored as a normalized Transport object (has .write), not a bare function.
    const stored = logger.settings.attachedTransports[0];
    expect(typeof stored).toBe("object");
    expect(typeof stored.write).toBe("function");

    // Per-transport minLevel gates this sink independently of the logger's minLevel.
    logger.info("info below transport minLevel");
    logger.error("error above transport minLevel");
    expect(writes).toBe(1);

    // Detach removes the transport; subsequent logs are not delivered.
    detach();
    expect(logger.settings.attachedTransports.length).toBe(0);
    logger.fatal("after detach");
    expect(writes).toBe(1);
  });
});
