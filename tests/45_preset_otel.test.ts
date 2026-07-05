import { Logger } from "../src/index.js";
import type { IErrorObject, ILogObjMeta, IMeta, ISettings } from "../src/interfaces.js";
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

    test("pins the OTel-spec severity integers for tslog levels 0..6, independent of the enum", () => {
      // Hardcoded from the OTel logs data-model spec: if OtelSeverityNumber ever drifted from the spec,
      // enum-based assertions would drift with it — these integer literals anchor the wire contract.
      const specSeverity = [1, 2, 5, 9, 13, 17, 21];
      for (let levelId = 0; levelId <= 6; levelId++) {
        expect(levelToSeverityNumber(levelId)).toBe(specSeverity[levelId]);
      }
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

/** Settings whose json/meta key names match the runtime defaults, for direct hand-built-record tests. */
function defaultSettings(): ISettings<unknown> {
  return new Logger({ type: "hidden" }).settings as unknown as ISettings<unknown>;
}

/** Build a serialized-tslog {@link IErrorObject} (native handle + parsed frames), with overrides. */
function makeErrorObject(overrides: Partial<IErrorObject> & { nativeError?: unknown } = {}): IErrorObject {
  return {
    nativeError: new Error("real"),
    name: "E",
    message: "m",
    stack: [{ method: "fn", filePath: "/a.js", fileLine: "1", fileColumn: "2" }],
    ...overrides,
  } as IErrorObject;
}

describe("presets/otel toOtlpAnyValue exhaustive value kinds", () => {
  test("functions and symbols degrade to their String() form", () => {
    expect(toOtlpAnyValue(() => {})).toEqual({ stringValue: expect.stringContaining("=>") });
    const sym = Symbol("s");
    expect(toOtlpAnyValue(sym)).toEqual({ stringValue: "Symbol(s)" });
  });

  test("Dates map to an ISO stringValue; an invalid Date maps to 'Invalid Date'", () => {
    const iso = "2026-07-05T00:00:00.000Z";
    expect(toOtlpAnyValue(new Date(iso))).toEqual({ stringValue: iso });
    expect(toOtlpAnyValue(new Date(Number.NaN))).toEqual({ stringValue: "Invalid Date" });
  });

  test("a raw Error becomes a kvlist of name/message/stack (stack included when present)", () => {
    const err = new Error("kaboom");
    const kv = toOtlpAnyValue(err).kvlistValue?.values ?? [];
    const byKey = (k: string) => kv.find((e) => e.key === k)?.value;
    expect(byKey("name")).toEqual({ stringValue: "Error" });
    expect(byKey("message")).toEqual({ stringValue: "kaboom" });
    expect(typeof byKey("stack")?.stringValue).toBe("string");
  });

  test("a raw Error with name/message/stack scrubbed uses the safe fallbacks and omits stack", () => {
    // Defeat every readable prop: name/message resolve to the "Error"/"" fallbacks; a non-string stack
    // (deleted -> undefined) is omitted entirely.
    const err = Object.create(Error.prototype) as Error;
    Object.defineProperty(err, "name", { value: 123 }); // non-string -> safeStringProp returns undefined
    Object.defineProperty(err, "message", { value: undefined });
    Object.defineProperty(err, "stack", { value: undefined });
    const kv = toOtlpAnyValue(err).kvlistValue?.values ?? [];
    const byKey = (k: string) => kv.find((e) => e.key === k)?.value;
    expect(byKey("name")).toEqual({ stringValue: "Error" });
    expect(byKey("message")).toEqual({ stringValue: "" });
    expect(byKey("stack")).toBeUndefined();
  });

  test("a raw Error whose stack getter throws still serializes name/message and omits stack", () => {
    const err = new Error("boom");
    Object.defineProperty(err, "stack", {
      get() {
        throw new Error("hostile stack");
      },
    });
    const kv = toOtlpAnyValue(err).kvlistValue?.values ?? [];
    const byKey = (k: string) => kv.find((e) => e.key === k)?.value;
    expect(byKey("message")).toEqual({ stringValue: "boom" });
    expect(byKey("stack")).toBeUndefined();
  });

  test("an object whose ownKeys trap throws degrades to '[unserializable]'", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no keys");
        },
      },
    );
    expect(toOtlpAnyValue(hostile)).toEqual({ stringValue: "[unserializable]" });
  });
});

describe("presets/otel record-splitting and timestamp edges", () => {
  test("a record with no message/positional key leaves Body undefined and keeps all fields as attributes", () => {
    // No "0", no messageKey, no spread hint -> splitBodyAndAttributes falls through to body: undefined.
    const settings = defaultSettings();
    const meta = { logLevelId: 3, logLevelName: "INFO", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const record = { alpha: 1, beta: "two", [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otel = toOtelRecord(record, settings);
    expect(otel.Body).toBeUndefined();
    expect(otel.Attributes).toEqual({ alpha: 1, beta: "two" });
  });

  test("a spread-hinted record whose fields are a serialized error is NOT spread (guarded by isPlainErrorLike)", () => {
    // The object-first call shape (`log.info(obj, "msg")`) stamps the spread hint on the record — and a
    // hand-built serialized-error-like (nativeError + name/message/stack) IS a plain object that Node's
    // isNativeError does not classify as an Error, so the real pipeline hints it. The same call shape with
    // plain fields spreads (see "produces the OTel log-record shape" above); here isPlainErrorLike must
    // short-circuit the spread so the error is not exploded into name/message/stack attributes.
    const errLike = makeErrorObject({ name: "Boom", message: "spread me not" });
    const { record, settings } = captureRecord([errLike, "the message"]);
    const otel = toOtelRecord(record, settings);
    // Not spread: "0" then falls through to the legacy bare-body promotion, leaving "1" positional.
    expect(otel.Body).toBe((record as Record<string, unknown>)["0"]);
    expect(otel.Body).toMatchObject({ name: "Boom", message: "spread me not" });
    expect((otel.Attributes as Record<string, unknown>)["1"]).toBe("the message");
    expect(otel.Attributes.name).toBeUndefined();
    expect((otel.Attributes as Record<string, unknown>)["0"]).toBeUndefined();
  });

  test("no _meta block: OTLP severity is UNSPECIFIED and the timestamp falls back to Date.now()", () => {
    const settings = defaultSettings();
    const before = BigInt(Date.now()) * 1_000_000n;
    const otlp = toOtlpLogRecord({ 0: "no meta" } as unknown as Record<string, unknown> & ILogObjMeta, settings);
    const after = BigInt(Date.now()) * 1_000_000n;
    expect(otlp.severityNumber).toBe(0); // UNSPECIFIED per the OTel spec
    expect(otlp.severityText).toBe("");
    // toEpochNanos(undefined) -> Date.now(): the ns timestamp sits within the call window.
    const ts = BigInt(otlp.timeUnixNano);
    expect(ts >= before && ts <= after).toBe(true);
    expect(otlp.body).toEqual({ stringValue: "no meta" });
  });
});

describe("presets/otel toOtlpLogRecord error edges", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  test("multiple logged errors: the first maps to exception.*, the rest compact under the error key", () => {
    const { record, settings } = captureRecord(["multi", new Error("first"), new TypeError("second")]);
    const otlp = toOtlpLogRecord(record, settings);
    expect(attr(otlp.attributes, "exception.type")).toEqual({ stringValue: "Error" });
    expect(attr(otlp.attributes, "exception.message")).toEqual({ stringValue: "first" });
    // The extra error rides under json.errorKey as a compact kvlist array (no native handle).
    const extra = attr(otlp.attributes, settings.json.errorKey)?.arrayValue?.values ?? [];
    expect(extra).toHaveLength(1);
    const extraKv = extra[0].kvlistValue?.values ?? [];
    expect(extraKv.find((e) => e.key === "name")?.value).toEqual({ stringValue: "TypeError" });
    expect(extraKv.find((e) => e.key === "message")?.value).toEqual({ stringValue: "second" });
  });

  test("a compacted extra error keeps its cause chain (compactError recursion + string stack)", () => {
    // First error owns the semconv slots; the SECOND error (with a cause) is compacted, exercising the
    // compactError cause recursion and the frame-rebuilt stack string.
    const primary = new Error("primary");
    const secondary = new Error("secondary", { cause: new Error("deep cause") });
    const { record, settings } = captureRecord(["boom", primary, secondary]);
    const otlp = toOtlpLogRecord(record, settings);
    const extra = attr(otlp.attributes, settings.json.errorKey)?.arrayValue?.values ?? [];
    const kv = extra[0].kvlistValue?.values ?? [];
    const byKey = (k: string) => kv.find((e) => e.key === k)?.value;
    expect(byKey("name")).toEqual({ stringValue: "Error" });
    expect(byKey("message")).toEqual({ stringValue: "secondary" });
    expect(typeof byKey("stack")?.stringValue).toBe("string");
    // the compacted cause is a nested kvlist with its own name/message
    const causeKv = byKey("cause")?.kvlistValue?.values ?? [];
    expect(causeKv.find((e) => e.key === "message")?.value).toEqual({ stringValue: "deep cause" });
  });

  test("an attribute holding an ARRAY of serialized errors maps them all (first -> exception.*, rest compacted)", () => {
    // tslog does not produce this shape itself, but toOtlpLogRecord defends against an attribute value
    // that is an array of serialized errors: each is mapped in order.
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const errors = [makeErrorObject({ name: "AErr", message: "a" }), makeErrorObject({ name: "BErr", message: "b" })];
    const record = { message: "arr", failures: errors, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(record, settings);
    expect(attr(otlp.attributes, "exception.type")).toEqual({ stringValue: "AErr" });
    const extra = attr(otlp.attributes, settings.json.errorKey)?.arrayValue?.values ?? [];
    expect(extra).toHaveLength(1);
    expect((extra[0].kvlistValue?.values ?? []).find((e) => e.key === "name")?.value).toEqual({ stringValue: "BErr" });
    // the raw "failures" key is consumed by the error mapping, not emitted as a generic attribute
    expect(attr(otlp.attributes, "failures")).toBeUndefined();
  });

  test("errorStackString appends a non-error cause as a 'Caused by:' fallback section", () => {
    // A serialized error whose cause is a plain (non-error) value: the cause chain closes with a
    // Caused-by fallback rendered through stringifyFallbackSafe.
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const errLike = makeErrorObject({
      name: "Outer",
      message: "outer",
      nativeError: (() => {
        const e = new Error("outer");
        e.stack = undefined; // force ownStackString to rebuild from frames
        return e;
      })(),
      cause: { code: "E_PLAIN" } as unknown as IErrorObject,
    });
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(record, settings);
    const stacktrace = attr(otlp.attributes, "exception.stacktrace")?.stringValue ?? "";
    // frame-rebuilt own stack (no header, just the "    at" frame) + the plain-cause fallback line.
    expect(stacktrace).toContain("    at fn (/a.js:1:2)");
    expect(stacktrace).toContain('Caused by: {"code":"E_PLAIN"}');
  });

  test("a lone error with an empty parsed stack and no native stack yields no stacktrace attribute", () => {
    // ownStackString: native stack unreadable AND stack array empty -> undefined -> no exception.stacktrace.
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const native = new Error("x");
    native.stack = undefined;
    const errLike = makeErrorObject({ name: "NoStack", message: "ns", nativeError: native, stack: [] });
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(record, settings);
    expect(attr(otlp.attributes, "exception.type")).toEqual({ stringValue: "NoStack" });
    expect(attr(otlp.attributes, "exception.stacktrace")).toBeUndefined();
  });

  test("isolates a throwing getSpanContext in toOtlpLogRecord (no trace id injected, log survives)", () => {
    const { record, settings } = captureRecord(["safe"]);
    const otlp = toOtlpLogRecord(record, settings, {
      getSpanContext: () => {
        throw new Error("tracer down");
      },
    });
    expect(otlp.traceId).toBeUndefined();
    expect(otlp.spanId).toBeUndefined();
    expect(otlp.body).toEqual({ stringValue: "safe" });
  });
});

describe("presets/otel stringifyFallbackSafe / errorStackString cause fallbacks", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  test("a non-error cause that is a plain string is emitted verbatim as the Caused-by section", () => {
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const errLike = makeErrorObject({ name: "Outer", message: "outer", cause: "just a string" as unknown as IErrorObject });
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const stacktrace = attr(toOtlpLogRecord(record, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(stacktrace).toContain("Caused by: just a string");
  });

  test("a non-error cause whose JSON.stringify throws falls back through String()", () => {
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    // A cause object that is neither an error-like nor JSON-serializable (bigint + a hostile toString that
    // still yields a string) exercises stringifyFallbackSafe's JSON.stringify->String() fallback.
    const hostileCause = {
      big: 10n, // JSON.stringify throws on bigint
      toString() {
        return "hostile-cause-string";
      },
    };
    const errLike = makeErrorObject({ name: "Outer", message: "outer", cause: hostileCause as unknown as IErrorObject });
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const stacktrace = attr(toOtlpLogRecord(record, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(stacktrace).toContain("Caused by: hostile-cause-string");
  });
});

describe("presets/otel toOtlpJson envelope edges", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  test("accepts an ARRAY of records and emits empty resource attributes when no resource is given", () => {
    const { record, settings } = captureRecord(["one"]);
    const { record: record2 } = captureRecord(["two"]);
    const request = toOtlpJson([record, record2], settings);
    expect(request.resourceLogs[0].resource.attributes).toEqual([]);
    const logRecords = request.resourceLogs[0].scopeLogs[0].logRecords;
    expect(logRecords).toHaveLength(2);
    expect(logRecords[0].body).toEqual({ stringValue: "one" });
    expect(logRecords[1].body).toEqual({ stringValue: "two" });
  });

  test("otlpBatchBody with zero lines emits an empty resourceLogs envelope", () => {
    const { body, contentType } = otlpBatchBody([]);
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ resourceLogs: [] });
  });
});

describe("presets/otel stacktrace frame rebuild + cause-chain rendering", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  /** Build an IErrorObject-holding record with a mapped lone error under a plain key (`err`). */
  function recordWithError(errLike: IErrorObject): { record: Record<string, unknown> & ILogObjMeta; settings: ISettings<unknown> } {
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    return { record, settings };
  }

  test("rebuilds the stacktrace from parsed frames, filling every per-field fallback for empty frames", () => {
    // Native stack absent -> ownStackString rebuilds from the frame array. A fully empty frame exercises
    // the `<anonymous>`/`unknown`/`0`/`0` fallbacks; a `fullFilePath` frame exercises the preferred path.
    const native = new Error("x");
    native.stack = undefined;
    const errLike = makeErrorObject({
      name: "Framed",
      message: "fm",
      nativeError: native,
      stack: [{} as never, { fullFilePath: "/full.js", fileLine: "9", fileColumn: "8", method: "run" } as never],
    });
    const { record, settings } = recordWithError(errLike);
    const stacktrace = attr(toOtlpLogRecord(record, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(stacktrace).toContain("    at <anonymous> (unknown:0:0)");
    expect(stacktrace).toContain("    at run (/full.js:9:8)");
  });

  test("a serialized-error cause with an empty message and no readable stack renders a bare header", () => {
    // cause.message === "" (605: the empty-suffix arm); ownStackString(cause) undefined (607: header arm).
    const causeNative = new Error("");
    causeNative.stack = undefined;
    const cause = makeErrorObject({ name: "BareCause", message: "", nativeError: causeNative, stack: [] });
    const errLike = makeErrorObject({ name: "Outer", message: "outer", cause });
    const { record, settings } = recordWithError(errLike);
    const stacktrace = attr(toOtlpLogRecord(record, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    // header with no ": message" suffix and no following frames.
    expect(stacktrace).toContain("Caused by: BareCause");
    expect(stacktrace).not.toContain("Caused by: BareCause:");
  });
});

describe("presets/otel stringifyFallbackSafe deep fallbacks", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }
  function recordWithError(errLike: IErrorObject): { record: Record<string, unknown> & ILogObjMeta; settings: ISettings<unknown> } {
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const record = { message: "boom", err: errLike, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    return { record, settings };
  }

  test("a non-error cause degrades through both stringify fallback tiers: String(), then [unserializable]", () => {
    // Tier 1: JSON.stringify(function) returns undefined -> the `?? String(value)` arm renders the function.
    const fnCause = function namedCause() {};
    const fnErrLike = makeErrorObject({ name: "Outer", message: "outer", cause: fnCause as unknown as IErrorObject });
    const { record: fnRecord, settings } = recordWithError(fnErrLike);
    const fnStacktrace = attr(toOtlpLogRecord(fnRecord, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(fnStacktrace).toContain("Caused by: function namedCause");

    // Tier 2 (deepest): JSON.stringify throws (bigint) AND String() throws (Symbol.toPrimitive throws)
    // -> the inner catch returns "[unserializable]".
    const hostileCause = {
      big: 10n, // JSON.stringify throws
      [Symbol.toPrimitive]() {
        throw new Error("no primitive"); // String() throws
      },
    };
    const hostileErrLike = makeErrorObject({ name: "Outer", message: "outer", cause: hostileCause as unknown as IErrorObject });
    const { record: hostileRecord } = recordWithError(hostileErrLike);
    const hostileStacktrace = attr(toOtlpLogRecord(hostileRecord, settings).attributes, "exception.stacktrace")?.stringValue ?? "";
    expect(hostileStacktrace).toContain("Caused by: [unserializable]");
  });

  test("a compacted extra error with a NON-error cause renders the cause via stringifyFallbackSafe", () => {
    // compactError's `looksLikeErrorObject(cause) ? ... : stringifyFallbackSafe(cause)` -> the plain-cause arm.
    const settings = defaultSettings();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const primary = makeErrorObject({ name: "Primary", message: "primary" });
    const secondary = makeErrorObject({ name: "Secondary", message: "secondary", cause: { plain: "cause" } as unknown as IErrorObject });
    const record = { message: "boom", a: primary, b: secondary, [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(record, settings);
    const extra = attr(otlp.attributes, settings.json.errorKey)?.arrayValue?.values ?? [];
    const kv = extra[0].kvlistValue?.values ?? [];
    const causeValue = kv.find((e) => e.key === "cause")?.value;
    // the plain cause is stringified, not recursed into a kvlist.
    expect(causeValue).toEqual({ stringValue: '{"plain":"cause"}' });
  });
});

describe("presets/otel re-hydrated _meta.date and spread-error message arm", () => {
  function attr(list: OtlpKeyValue[] | undefined, key: string): OtlpKeyValue["value"] | undefined {
    return list?.find((entry) => entry.key === key)?.value;
  }

  test("a re-hydrated ISO-string _meta.date (JSON round-trip shape) falls back to Date.now()", () => {
    // In-process meta.date is always a Date; the realistic non-Date shape is the ISO STRING a JSON
    // round-trip re-hydrates. toEpochNanos only understands Date/number, so the string takes the
    // Date.now() fallback rather than being misread as an epoch value.
    const settings = defaultSettings();
    const meta = { logLevelId: 3, logLevelName: "INFO", date: "2023-11-14T22:13:20.000Z" } as unknown as IMeta;
    const record = { message: "iso-date", [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const before = BigInt(Date.now()) * 1_000_000n;
    const otlp = toOtlpLogRecord(record, settings);
    const after = BigInt(Date.now()) * 1_000_000n;
    const ts = BigInt(otlp.timeUnixNano);
    expect(ts >= before && ts <= after).toBe(true);
  });

  test("a re-hydrated numeric _meta.date (epoch ms) converts exactly to nanoseconds", () => {
    // toEpochNanos declares Date | number | undefined: the number arm is the tolerant-input contract
    // for records re-hydrated from storage where the date was serialized as epoch milliseconds.
    const settings = defaultSettings();
    const meta = { logLevelId: 3, logLevelName: "INFO", date: 1_700_000_000_000 } as unknown as IMeta;
    const record = { message: "epoch-date", [settings.meta.property]: meta } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(record, settings);
    expect(BigInt(otlp.timeUnixNano)).toBe(1_700_000_000_000n * 1_000_000n);
  });

  test("a spread lone error keeps its own STRING message when the messageKey is not 'message'", () => {
    // With messageKey = "msg", the error's `message` field is NOT the messageKey, so the split leaves it in
    // place: spreadError.message is a string -> the FIRST ternary arm of messageText is taken.
    const settings = { ...defaultSettings() } as ISettings<unknown>;
    (settings.json as unknown as Record<string, unknown>).messageKey = "msg";
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date(1_700_000_000_000) } as unknown as IMeta;
    const spread = {
      nativeError: new Error("real"),
      name: "Weird",
      message: "kept-string-message",
      stack: [{ method: "fn", filePath: "/a.js", fileLine: "1", fileColumn: "2" }],
      [settings.meta.property]: meta,
    } as unknown as Record<string, unknown> & ILogObjMeta;
    const otlp = toOtlpLogRecord(spread, settings);
    expect(attr(otlp.attributes, "exception.type")).toEqual({ stringValue: "Weird" });
    expect(attr(otlp.attributes, "exception.message")).toEqual({ stringValue: "kept-string-message" });
  });
});
