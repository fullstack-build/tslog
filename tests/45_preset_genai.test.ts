import { describe, expect, test } from "vitest";
import { genai, genaiAttributes, genaiSummary } from "../src/subpaths/presets/genai.js";

// Tests for the `tslog/presets/genai` OpenTelemetry-GenAI helper (M4.1/M4.2).
// Assert the documented gen_ai.* attribute mapping, the friendly summary, and the
// "only emit provided fields" / runtime-agnostic guarantees.

describe("presets/genai", () => {
  test("maps the friendly input to documented gen_ai.* attributes", () => {
    const { gen_ai: attrs } = genai({
      model: "claude-opus-4",
      inputTokens: 1200,
      outputTokens: 350,
      tool: "search",
      system: "anthropic",
    });

    expect(attrs["gen_ai.request.model"]).toBe("claude-opus-4");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(1200);
    expect(attrs["gen_ai.usage.output_tokens"]).toBe(350);
    expect(attrs["gen_ai.tool.name"]).toBe("search");
    expect(attrs["gen_ai.system"]).toBe("anthropic");
    // operation defaults to "chat"
    expect(attrs["gen_ai.operation.name"]).toBe("chat");
  });

  test("builds the friendly summary {model, tokens, costUsd, latencyMs}", () => {
    const { genai: summary } = genai({
      model: "gpt-x",
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.0042,
      latencyMs: 845,
    });

    expect(summary).toEqual({
      model: "gpt-x",
      tokens: 125,
      costUsd: 0.0042,
      latencyMs: 845,
    });
  });

  test("only emits keys for provided values (no empty/undefined noise)", () => {
    const { gen_ai: attrs, genai: summary } = genai({ model: "m" });

    expect(attrs).toEqual({
      "gen_ai.request.model": "m",
      "gen_ai.operation.name": "chat",
    });
    expect("gen_ai.usage.input_tokens" in attrs).toBe(false);
    expect("gen_ai.tool.name" in attrs).toBe(false);
    expect(summary).toEqual({ model: "m" });
    expect("tokens" in summary).toBe(false);
    expect("costUsd" in summary).toBe(false);
  });

  test("token total handles a single side and ignores non-finite numbers", () => {
    expect(genai({ inputTokens: 40 }).genai.tokens).toBe(40);
    expect(genai({ outputTokens: 7 }).genai.tokens).toBe(7);
    // NaN / non-finite are not emitted
    expect("tokens" in genai({ inputTokens: Number.NaN }).genai).toBe(false);
    expect("gen_ai.usage.input_tokens" in genai({ inputTokens: Number.NaN }).gen_ai).toBe(false);
  });

  test("maps request/response detail fields", () => {
    const { gen_ai: attrs } = genai({
      model: "req-model",
      responseModel: "resp-model",
      responseId: "resp-123",
      operation: "execute_tool",
      finishReasons: ["stop", "length"],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 2048,
    });

    expect(attrs["gen_ai.request.model"]).toBe("req-model");
    expect(attrs["gen_ai.response.model"]).toBe("resp-model");
    expect(attrs["gen_ai.response.id"]).toBe("resp-123");
    expect(attrs["gen_ai.operation.name"]).toBe("execute_tool");
    expect(attrs["gen_ai.response.finish_reasons"]).toEqual(["stop", "length"]);
    expect(attrs["gen_ai.request.temperature"]).toBe(0.7);
    expect(attrs["gen_ai.request.top_p"]).toBe(0.9);
    expect(attrs["gen_ai.request.max_tokens"]).toBe(2048);
  });

  test("summary falls back to responseModel when model is absent", () => {
    expect(genai({ responseModel: "only-resp" }).genai.model).toBe("only-resp");
  });

  test("merges extra attributes verbatim, skipping undefined", () => {
    const { gen_ai: attrs } = genai({
      model: "m",
      attributes: { "gen_ai.request.frequency_penalty": 0.5, "custom.flag": true, "skip.me": undefined },
    });

    expect(attrs["gen_ai.request.frequency_penalty"]).toBe(0.5);
    expect(attrs["custom.flag"]).toBe(true);
    expect("skip.me" in attrs).toBe(false);
  });

  test("does not mutate caller-provided arrays", () => {
    const reasons = ["stop"];
    const { gen_ai: attrs } = genai({ finishReasons: reasons });
    (attrs["gen_ai.response.finish_reasons"] as string[]).push("mutated");
    expect(reasons).toEqual(["stop"]);
  });

  test("empty finishReasons array is omitted", () => {
    expect("gen_ai.response.finish_reasons" in genai({ finishReasons: [] }).gen_ai).toBe(false);
  });

  test("convenience accessors return the matching slices", () => {
    const input = { model: "m", inputTokens: 5, outputTokens: 5, costUsd: 1, latencyMs: 10 };
    expect(genaiAttributes(input)).toEqual(genai(input).gen_ai);
    expect(genaiSummary(input)).toEqual({ model: "m", tokens: 10, costUsd: 1, latencyMs: 10 });
  });

  test("no-arg call yields a sane default record", () => {
    const r = genai();
    expect(r.gen_ai).toEqual({ "gen_ai.operation.name": "chat" });
    expect(r.genai).toEqual({});
  });
});
