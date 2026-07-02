import { Logger } from "../src/index.js";
import type { ILogObjMeta, ISettings } from "../src/interfaces.js";
import {
  levelToSeverityNumber,
  type OtelLogRecord,
  OtelSeverityNumber,
  type OtelSpanContext,
  otelFormat,
  otelTraceContext,
  stringifyOtelRecord,
  toOtelRecord,
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

    test("merges resource attributes, with user fields winning on collision", () => {
      const { record, settings } = captureRecord([{ "service.name": "from-user", region: "eu" }, "hi"]);
      const otel = toOtelRecord(record, settings, { resource: { "service.name": "default", "deployment.environment": "prod" } });
      expect(otel.Attributes["service.name"]).toBe("from-user");
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
