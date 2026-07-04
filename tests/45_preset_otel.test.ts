import { Logger } from "../src/index.js";
import type { ILogObjMeta, ISettings } from "../src/interfaces.js";
import {
  levelToSeverityNumber,
  type OtelLogRecord,
  OtelSeverityNumber,
  type OtelSpanContext,
  type OtlpExportLogsRequest,
  type OtlpKeyValue,
  otelFormat,
  otelTraceContext,
  otlpBatchBody,
  otlpFormat,
  stringifyOtelRecord,
  toOtelRecord,
  toOtlpAnyValue,
  toOtlpJson,
  toOtlpLogRecord,
} from "../src/subpaths/presets/otel.js";

/**
 * Build a real, finished tslog record (user fields + `_meta`) by capturing it from a transport. This
 * exercises the same record shape the OTel preset sees in production rather than hand-rolling `_meta`.
 */
function captureRecord(
  logArgs: unknown[],
  settingsParam: Record<string, unknown> = {},
): { record: Record<string, unknown> & ILogObjMeta; settings: ISettings<unknown> } {
  let captured: (Record<string, unknown> & ILogObjMeta) | undefined;
  const logger = new Logger({ type: "hidden", ...settingsParam });
  logger.attachTransport((record) => {
    captured = record as Record<string, unknown> & ILogObjMeta;
  });
  logger.info(...logArgs);
  if (captured == null) {
    throw new Error("no record captured");
  }
  return { record: captured, settings: logger.settings as unknown as ISettings<unknown> };
}

describe("presets/otel", () => {
  describe("levelToSeverityNumber", () => {
    test("maps the 7 default levels onto the OTel severity bands", () => {
      expect(levelToSeverityNumber(0)).toBe(OtelSeverityNumber.TRACE); // SILLY -> 1
      expect(levelToSeverityNumber(1)).toBe(OtelSeverityNumber.TRACE2); // TRACE -> 2
      expect(levelToSeverityNumber(2)).toBe(OtelSeverityNumber.DEBUG); // 5
      expect(levelToSeverityNumber(3)).toBe(OtelSeverityNumber.INFO); // 9
      expect(levelToSeverityNumber(4)).toBe(OtelSeverityNumber.WARN); // 13
      expect(levelToSeverityNumber(5)).toBe(OtelSeverityNumber.ERROR); // 17
      expect(levelToSeverityNumber(6)).toBe(OtelSeverityNumber.FATAL); // 21
    });

    test("buckets unknown/custom level ids into the nearest band by magnitude", () => {
      expect(levelToSeverityNumber(2.5)).toBe(OtelSeverityNumber.INFO);
      expect(levelToSeverityNumber(4.5)).toBe(OtelSeverityNumber.WARN);
      expect(levelToSeverityNumber(5.5)).toBe(OtelSeverityNumber.ERROR);
      expect(levelToSeverityNumber(99)).toBe(OtelSeverityNumber.FATAL);
      expect(levelToSeverityNumber(0.5)).toBe(OtelSeverityNumber.TRACE); // < 1 -> TRACE
      expect(levelToSeverityNumber(1.5)).toBe(OtelSeverityNumber.DEBUG); // < 2 -> DEBUG
      expect(levelToSeverityNumber(-1)).toBe(OtelSeverityNumber.TRACE);
    });
  });

  describe("toOtelRecord", () => {
    test("produces the OTel log-record shape: severity, text, ns timestamp, body, attributes", () => {
      const { record, settings } = captureRecord([{ userId: 42, action: "login" }, "user logged in"]);
      const otel = toOtelRecord(record, settings);

      expect(otel.SeverityNumber).toBe(OtelSeverityNumber.INFO);
      expect(otel.SeverityText).toBe("INFO");
      expect(otel.Body).toBe("user logged in");
      expect(otel.Attributes).toMatchObject({ userId: 42, action: "login" });

      // Timestamp is bigint nanoseconds derived from _meta.date (ms * 1e6).
      const meta = record._meta as unknown as { date: Date };
      expect(typeof otel.Timestamp).toBe("bigint");
      expect(otel.Timestamp).toBe(BigInt(meta.date.getTime()) * 1_000_000n);
      expect(otel.ObservedTimestamp).toBe(otel.Timestamp);
    });

    test("uses a bare string log as Body and leaves Attributes empty", () => {
      const { record, settings } = captureRecord(["just a message"]);
      const otel = toOtelRecord(record, settings);
      expect(otel.Body).toBe("just a message");
      // No "0" key leaked into attributes.
      expect(Object.keys(otel.Attributes)).not.toContain("0");
    });

    test("merges resource attributes, resource identity winning on collision", () => {
      const { record, settings } = captureRecord([{ "service.name": "from-user", region: "eu" }, "hi"]);
      const otel = toOtelRecord(record, settings, { resource: { "service.name": "default", "deployment.environment": "prod" } });
      // Resource attributes describe the EMITTER, not the event — they outrank a colliding log field.
      expect(otel.Attributes["service.name"]).toBe("default");
      expect(otel.Attributes["deployment.environment"]).toBe("prod");
      expect(otel.Attributes.region).toBe("eu");
    });

    test("omits ObservedTimestamp when disabled", () => {
      const { record, settings } = captureRecord(["x"]);
      const otel = toOtelRecord(record, settings, { observedTimestamp: false });
      expect(otel.ObservedTimestamp).toBeUndefined();
    });

    test("injects trace_id/span_id from the context getter", () => {
      const { record, settings } = captureRecord(["traced"]);
      const span: OtelSpanContext = { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 };
      const otel = toOtelRecord(record, settings, { getSpanContext: () => span });
      expect(otel.TraceId).toBe(span.traceId);
      expect(otel.SpanId).toBe(span.spanId);
      expect(otel.TraceFlags).toBe(1);
    });

    test("does not inject correlation when getter returns undefined", () => {
      const { record, settings } = captureRecord(["untraced"]);
      const otel = toOtelRecord(record, settings, { getSpanContext: () => undefined });
      expect(otel.TraceId).toBeUndefined();
      expect(otel.SpanId).toBeUndefined();
    });

    test("isolates a throwing context getter (never breaks logging)", () => {
      const { record, settings } = captureRecord(["safe"]);
      const otel = toOtelRecord(record, settings, {
        getSpanContext: () => {
          throw new Error("tracer unavailable");
        },
      });
      expect(otel.TraceId).toBeUndefined();
      expect(otel.Body).toBe("safe");
    });

    test("emits UNSPECIFIED severity when no meta block is present", () => {
      const settings = { meta: { property: "_meta" }, json: { messageKey: "message" } } as unknown as ISettings<unknown>;
      const otel = toOtelRecord({ "0": "no meta" } as unknown as Record<string, unknown> & ILogObjMeta, settings);
      expect(otel.SeverityNumber).toBe(OtelSeverityNumber.UNSPECIFIED);
      expect(otel.SeverityText).toBe("");
      expect(otel.Body).toBe("no meta");
    });
  });

  describe("otelFormat / stringifyOtelRecord", () => {
    test("renders a JSON line with the bigint timestamp stringified", () => {
      const { record, settings } = captureRecord([{ k: "v" }, "line"]);
      const format = otelFormat({ getSpanContext: () => ({ traceId: "abc", spanId: "def" }) });
      const line = format(record as never, settings as never);
      const parsed = JSON.parse(line) as Record<string, unknown>;

      expect(typeof parsed.Timestamp).toBe("string"); // bigint -> string in JSON
      expect(parsed.SeverityNumber).toBe(OtelSeverityNumber.INFO);
      expect(parsed.SeverityText).toBe("INFO");
      expect(parsed.Body).toBe("line");
      expect((parsed.Attributes as Record<string, unknown>).k).toBe("v");
      expect(parsed.TraceId).toBe("abc");
      expect(parsed.SpanId).toBe("def");
    });

    test("stringifyOtelRecord stringifies bigint timestamps", () => {
      const rec: OtelLogRecord = {
        Timestamp: 1_700_000_000_000_000_000n,
        SeverityNumber: OtelSeverityNumber.WARN,
        SeverityText: "WARN",
        Body: "boom",
        Attributes: {},
      };
      const parsed = JSON.parse(stringifyOtelRecord(rec)) as Record<string, unknown>;
      expect(parsed.Timestamp).toBe("1700000000000000000");
    });

    test("works as a real transport format end-to-end", () => {
      const lines: string[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport({
        format: otelFormat(),
        write: (_record, line) => {
          lines.push(line);
        },
      });
      logger.warn({ code: "E_X" }, "warned");

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(parsed.SeverityText).toBe("WARN");
      expect(parsed.SeverityNumber).toBe(OtelSeverityNumber.WARN);
      expect(parsed.Body).toBe("warned");
      expect((parsed.Attributes as Record<string, unknown>).code).toBe("E_X");
    });
  });

  describe("otelTraceContext middleware", () => {
    test("stashes trace_id/span_id on ctx.meta", () => {
      const mw = otelTraceContext({ getSpanContext: () => ({ traceId: "tt", spanId: "ss" }) });
      const ctx = { logLevelId: 3, logLevelName: "INFO", args: [], settings: {} as never, meta: {} as Record<string, unknown> };
      const result = mw(ctx);
      expect(result).toBe(ctx);
      expect(ctx.meta.trace_id).toBe("tt");
      expect(ctx.meta.span_id).toBe("ss");
    });

    test("is a no-op without a getter and isolates a throwing getter", () => {
      const ctxA = { logLevelId: 3, logLevelName: "INFO", args: [], settings: {} as never, meta: {} as Record<string, unknown> };
      expect(otelTraceContext({})(ctxA)).toBe(ctxA);
      expect(Object.keys(ctxA.meta)).toHaveLength(0);

      const ctxB = { logLevelId: 3, logLevelName: "INFO", args: [], settings: {} as never, meta: {} as Record<string, unknown> };
      const throwing = otelTraceContext({
        getSpanContext: () => {
          throw new Error("nope");
        },
      });
      expect(throwing(ctxB)).toBe(ctxB);
      expect(Object.keys(ctxB.meta)).toHaveLength(0);
    });
  });
});

describe("presets/otel OTLP/JSON (the collector wire format)", () => {
  /** Find an attribute by key in an OTLP attribute list. */
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  describe("toOtlpAnyValue", () => {
    test("maps primitives onto typed AnyValues (int64 as string, per proto3 JSON)", () => {
      expect(toOtlpAnyValue("s")).toEqual({ stringValue: "s" });
      expect(toOtlpAnyValue(true)).toEqual({ boolValue: true });
      expect(toOtlpAnyValue(42)).toEqual({ intValue: "42" });
      expect(toOtlpAnyValue(1.5)).toEqual({ doubleValue: 1.5 });
      expect(toOtlpAnyValue(10n)).toEqual({ intValue: "10" });
      expect(toOtlpAnyValue(Number.NaN)).toEqual({ stringValue: "NaN" });
      expect(toOtlpAnyValue(null)).toEqual({});
      expect(toOtlpAnyValue(undefined)).toEqual({});
    });

    test("maps arrays/objects onto arrayValue/kvlistValue recursively", () => {
      expect(toOtlpAnyValue([1, "a"])).toEqual({ arrayValue: { values: [{ intValue: "1" }, { stringValue: "a" }] } });
      expect(toOtlpAnyValue({ a: { b: true } })).toEqual({
        kvlistValue: { values: [{ key: "a", value: { kvlistValue: { values: [{ key: "b", value: { boolValue: true } }] } } }] },
      });
    });

    test("degrades circular structures and hostile getters instead of throwing", () => {
      const circular: Record<string, unknown> = { name: "c" };
      circular.self = circular;
      const converted = toOtlpAnyValue(circular);
      expect(JSON.stringify(converted)).toContain("[Circular]");

      const hostile = {
        fine: 1,
        get bad(): never {
          throw new Error("hostile");
        },
      };
      const kv = toOtlpAnyValue(hostile).kvlistValue;
      expect(attr(kv?.values, "fine")).toEqual({ intValue: "1" });
      expect(attr(kv?.values, "bad")).toBeUndefined();
    });
  });

  describe("toOtlpLogRecord", () => {
    test("emits proto3-JSON field names: ns-string timestamps, severity, stringValue body, typed attributes", () => {
      const { record, settings } = captureRecord([{ userId: 42, ratio: 0.5, ok: true }, "user logged in"]);
      const otlp = toOtlpLogRecord(record, settings);
      expect(otlp.timeUnixNano).toMatch(/^\d+$/);
      expect(otlp.observedTimeUnixNano).toBe(otlp.timeUnixNano);
      expect(BigInt(otlp.timeUnixNano) % 1_000_000n).toBe(0n); // ms-precision source
      expect(otlp.severityNumber).toBe(OtelSeverityNumber.INFO);
      expect(otlp.severityText).toBe("INFO");
      expect(otlp.body).toEqual({ stringValue: "user logged in" });
      expect(attr(otlp.attributes, "userId")).toEqual({ intValue: "42" });
      expect(attr(otlp.attributes, "ratio")).toEqual({ doubleValue: 0.5 });
      expect(attr(otlp.attributes, "ok")).toEqual({ boolValue: true });
    });

    test("carries a named logger as the logger.name attribute", () => {
      const { record, settings } = captureRecord(["hello"], { name: "checkout" });
      const otlp = toOtlpLogRecord(record, settings);
      expect(attr(otlp.attributes, "logger.name")).toEqual({ stringValue: "checkout" });
    });

    test("maps a logged Error onto the exception.* semantic conventions with a raw stack string", () => {
      let thrown: Error;
      try {
        throw new TypeError("otlp boom");
      } catch (error) {
        thrown = error as Error;
      }
      const { record, settings } = captureRecord(["request failed", thrown]);
      const otlp = toOtlpLogRecord(record, settings);
      expect(attr(otlp.attributes, "exception.type")).toEqual({ stringValue: "TypeError" });
      expect(attr(otlp.attributes, "exception.message")).toEqual({ stringValue: "otlp boom" });
      const stacktrace = attr(otlp.attributes, "exception.stacktrace");
      expect(typeof stacktrace?.stringValue).toBe("string");
      expect(stacktrace?.stringValue).toContain("otlp boom");
      // the error is fully represented by exception.*; no duplicate generic error attribute
      expect(attr(otlp.attributes, settings.json.errorKey)).toBeUndefined();
    });

    test("injects traceId/spanId from the getter, falling back to middleware-stashed _meta trace_id/span_id", () => {
      const { record, settings } = captureRecord(["with getter"]);
      const viaGetter = toOtlpLogRecord(record, settings, {
        getSpanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }),
      });
      expect(viaGetter.traceId).toBe("a".repeat(32));
      expect(viaGetter.spanId).toBe("b".repeat(16));
      expect(viaGetter.flags).toBe(1);

      const { record: stashedRecord, settings: stashedSettings } = captureRecord(["with middleware"], {
        middleware: [otelTraceContext({ getSpanContext: () => ({ traceId: "c".repeat(32), spanId: "d".repeat(16) }) })],
      });
      const viaMeta = toOtlpLogRecord(stashedRecord, stashedSettings);
      expect(viaMeta.traceId).toBe("c".repeat(32));
      expect(viaMeta.spanId).toBe("d".repeat(16));
    });
  });

  describe("toOtlpJson / otlpFormat / otlpBatchBody", () => {
    test("wraps records in the resourceLogs/scopeLogs/logRecords envelope with SEPARATE resource attributes", () => {
      const { record, settings } = captureRecord([{ "service.name": "from-user" }, "hi"]);
      const request = toOtlpJson(record, settings, {
        resource: { "service.name": "checkout", "deployment.environment": "prod" },
        scopeVersion: "1.2.3",
      });
      expect(request.resourceLogs).toHaveLength(1);
      const resourceLog = request.resourceLogs[0];
      expect(attr(resourceLog.resource.attributes, "service.name")).toEqual({ stringValue: "checkout" });
      expect(attr(resourceLog.resource.attributes, "deployment.environment")).toEqual({ stringValue: "prod" });
      expect(resourceLog.scopeLogs[0].scope).toEqual({ name: "tslog", version: "1.2.3" });
      const logRecord = resourceLog.scopeLogs[0].logRecords[0];
      // resource attrs live in the envelope only; the record keeps the user's own field
      expect(attr(logRecord.attributes, "deployment.environment")).toBeUndefined();
      expect(attr(logRecord.attributes, "service.name")).toEqual({ stringValue: "from-user" });
    });

    test("otlpFormat emits one full envelope per line; otlpBatchBody merges a batch into one envelope", () => {
      const { record, settings } = captureRecord(["batched"]);
      const format = otlpFormat({ resource: { "service.name": "merge-me" } });
      const line = format(record, settings);
      const single = JSON.parse(line) as OtlpExportLogsRequest;
      expect(single.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);

      const { body, contentType } = otlpBatchBody([line, line, line]);
      expect(contentType).toBe("application/json");
      const merged = JSON.parse(body) as OtlpExportLogsRequest;
      expect(merged.resourceLogs).toHaveLength(1);
      expect(merged.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3);
      expect(attr(merged.resourceLogs[0].resource.attributes, "service.name")).toEqual({ stringValue: "merge-me" });
    });

    test("otlpBatchBody rejects a non-OTLP line loudly instead of shipping a corrupt envelope", () => {
      expect(() => otlpBatchBody(['{"message":"plain json line"}'])).toThrow(/otlpBatchBody/);
    });

    test("end-to-end: httpTransport with otlpFormat + otlpBatchBody POSTs a single valid /v1/logs body", async () => {
      const { httpTransport } = await import("../src/subpaths/transports/http.js");
      const bodies: string[] = [];
      const contentTypes: (string | undefined)[] = [];
      const transport = httpTransport({
        url: "http://collector:4318/v1/logs",
        format: otlpFormat({ resource: { "service.name": "e2e" } }),
        encodeBody: otlpBatchBody,
        fetchImpl: (_url, init) => {
          bodies.push(init.body);
          contentTypes.push(init.headers["content-type"]);
          return Promise.resolve({ ok: true, status: 200 });
        },
      });
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(transport);
      logger.info("one", { n: 1 });
      logger.warn("two", { n: 2 });
      await logger.flush();
      await transport[Symbol.asyncDispose]();

      expect(bodies).toHaveLength(1);
      expect(contentTypes[0]).toBe("application/json");
      const envelope = JSON.parse(bodies[0]) as OtlpExportLogsRequest;
      const records = envelope.resourceLogs[0].scopeLogs[0].logRecords;
      expect(records).toHaveLength(2);
      expect(records[0].body).toEqual({ stringValue: "one" });
      expect(records[1].severityText).toBe("WARN");
      expect(attr(envelope.resourceLogs[0].resource.attributes, "service.name")).toEqual({ stringValue: "e2e" });
    });
  });
});

describe("presets/otel OTLP review fixes", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  test("message-first calls spread fields into attributes (no numeric keys), like the JSON renderer", () => {
    const { record, settings } = captureRecord(["user logged in", { userId: 42, action: "login" }]);
    const otlp = toOtlpLogRecord(record, settings);
    expect(otlp.body).toEqual({ stringValue: "user logged in" });
    expect(attr(otlp.attributes, "userId")).toEqual({ intValue: "42" });
    expect(attr(otlp.attributes, "action")).toEqual({ stringValue: "login" });
    expect(attr(otlp.attributes, "1")).toBeUndefined();
    expect(attr(otlp.attributes, "0")).toBeUndefined();
  });

  test("a single logged object with numeric keys is NOT sniffed as a spread shape (hint required)", () => {
    const { record, settings } = captureRecord([{ 0: { retries: 3 }, 1: "queued" }]);
    const otlp = toOtlpLogRecord(record, settings);
    // mirrors the JSON renderer: "0" is promoted to the body, "1" stays a positional attribute
    expect(otlp.body).toEqual(toOtlpAnyValue({ retries: 3 }));
    expect(attr(otlp.attributes, "1")).toEqual({ stringValue: "queued" });
    expect(attr(otlp.attributes, "retries")).toBeUndefined();
  });

  test("attribute keys are unique: reserved keys win over colliding user fields", () => {
    const { record, settings } = captureRecord([{ "logger.name": "impostor", ok: true }, "named"], { name: "real" });
    const otlp = toOtlpLogRecord(record, settings);
    const loggerNames = otlp.attributes?.filter((entry) => entry.key === "logger.name") ?? [];
    expect(loggerNames).toHaveLength(1);
    expect(loggerNames[0].value).toEqual({ stringValue: "real" });
    expect(attr(otlp.attributes, "ok")).toEqual({ boolValue: true });
  });

  test("a lone error's cause chain survives into exception.stacktrace as Caused by sections", () => {
    const { record, settings } = captureRecord([new Error("outer", { cause: new Error("inner cause") })]);
    const otlp = toOtlpLogRecord(record, settings);
    const stacktrace = attr(otlp.attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(stacktrace).toContain("Caused by: Error: inner cause");
    expect(attr(otlp.attributes, "exception.message")).toEqual({ stringValue: "outer" });
  });

  test("trace/span ids are lowercase-hex validated: invalid ids are dropped, valid uppercase is lowered", () => {
    const { record, settings } = captureRecord(["ids"]);
    const invalid = toOtlpLogRecord(record, settings, {
      getSpanContext: () => ({ traceId: "not-hex-not-32-chars", spanId: "z".repeat(16) }),
    });
    expect(invalid.traceId).toBeUndefined();
    expect(invalid.spanId).toBeUndefined();
    const uppercase = toOtlpLogRecord(record, settings, {
      getSpanContext: () => ({ traceId: "A".repeat(32), spanId: "B".repeat(16) }),
    });
    expect(uppercase.traceId).toBe("a".repeat(32));
    expect(uppercase.spanId).toBe("b".repeat(16));
  });
});
