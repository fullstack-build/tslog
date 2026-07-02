/**
 * `tslog/presets/genai` — runtime-agnostic helpers for emitting OpenTelemetry GenAI telemetry.
 *
 * {@link genai} turns a friendly, hand-written input describing a single model call into an object
 * carrying the documented OpenTelemetry `gen_ai.*` semantic-convention attributes, alongside a compact,
 * human-readable `{ model, tokens, costUsd, latencyMs }` summary. Spread the result into a log call:
 *
 * @example
 * import { genai } from "tslog/presets/genai";
 *
 * logger.info("chat completion", genai({
 *   model: "claude-opus-4",
 *   inputTokens: 1200,
 *   outputTokens: 350,
 *   costUsd: 0.021,
 *   latencyMs: 845,
 *   tool: "search",
 * }));
 *
 * No SDK, no I/O, no import-time side effects — pure mapping, safe in any runtime (Node, Deno, Bun, browser, edge).
 */

/** The OpenTelemetry GenAI operation kind (`gen_ai.operation.name`). */
export type GenAiOperation = "chat" | "text_completion" | "embeddings" | "execute_tool" | (string & {});

/**
 * Friendly input describing a single GenAI model interaction. Every field is optional so the helper can
 * be used for partial telemetry (e.g. only token usage, or only latency). Unknown extra `gen_ai.*` keys
 * may be supplied via {@link attributes} for forward compatibility with newer conventions.
 */
export interface GenAiInput {
  /** Model requested by the caller. Maps to `gen_ai.request.model`. */
  model?: string;
  /** Model that actually produced the response, if it differs. Maps to `gen_ai.response.model`. */
  responseModel?: string;
  /** Provider/system name (e.g. `"anthropic"`, `"openai"`). Maps to `gen_ai.system`. */
  system?: string;
  /** Operation kind. Maps to `gen_ai.operation.name`. Defaults to `"chat"` when omitted. */
  operation?: GenAiOperation;
  /** Prompt/input token count. Maps to `gen_ai.usage.input_tokens`. */
  inputTokens?: number;
  /** Completion/output token count. Maps to `gen_ai.usage.output_tokens`. */
  outputTokens?: number;
  /** Estimated cost of the call in US dollars. Surfaced in the friendly summary (no standard `gen_ai.*` key). */
  costUsd?: number;
  /** End-to-end latency of the call in milliseconds. Surfaced in the friendly summary. */
  latencyMs?: number;
  /** Tool/function name for tool-execution calls. Maps to `gen_ai.tool.name`. */
  tool?: string;
  /** Provider-assigned response id. Maps to `gen_ai.response.id`. */
  responseId?: string;
  /** Reasons the generation finished (e.g. `["stop"]`). Maps to `gen_ai.response.finish_reasons`. */
  finishReasons?: string[];
  /** Sampling temperature. Maps to `gen_ai.request.temperature`. */
  temperature?: number;
  /** Top-p sampling. Maps to `gen_ai.request.top_p`. */
  topP?: number;
  /** Requested max output tokens. Maps to `gen_ai.request.max_tokens`. */
  maxTokens?: number;
  /** Escape hatch: extra `gen_ai.*` (or any) attributes merged verbatim into the emitted attributes. */
  attributes?: Record<string, unknown>;
}

/**
 * Compact, human-friendly rollup of a GenAI call, suitable for pretty console output and quick scanning.
 * `tokens` is the sum of input + output tokens when either is present.
 */
export interface GenAiSummary {
  model?: string;
  tokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

/**
 * The object returned by {@link genai}: the flat OpenTelemetry `gen_ai.*` attribute set plus a nested,
 * human-friendly {@link GenAiSummary}. Spread directly into a tslog call.
 */
export interface GenAiRecord {
  /** Flat OpenTelemetry GenAI semantic-convention attributes (`gen_ai.request.model`, `gen_ai.usage.*`, …). */
  gen_ai: GenAiAttributes;
  /** Human-friendly rollup: `{ model, tokens, costUsd, latencyMs }`. */
  genai: GenAiSummary;
}

/** Flat map of OpenTelemetry GenAI attribute keys to values; only keys with provided values are present. */
export type GenAiAttributes = Record<string, unknown>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function setIf(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

/**
 * Map a {@link GenAiInput} to OpenTelemetry GenAI `gen_ai.*` attributes plus a friendly summary.
 *
 * The attribute keys follow the OpenTelemetry GenAI semantic conventions:
 * - `gen_ai.system`, `gen_ai.operation.name`
 * - `gen_ai.request.model`, `gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.max_tokens`
 * - `gen_ai.response.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`
 * - `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`
 * - `gen_ai.tool.name`
 *
 * Only keys whose values are provided (non-`undefined`/`null`/empty-string) are emitted. The returned
 * object also carries a `genai` summary `{ model, tokens, costUsd, latencyMs }` for human-readable output.
 * Pure and runtime-agnostic — no I/O, no SDK dependency, no import-time side effects.
 */
export function genai(input: GenAiInput = {}): GenAiRecord {
  const attributes: GenAiAttributes = {};

  setIf(attributes, "gen_ai.system", input.system);
  setIf(attributes, "gen_ai.operation.name", input.operation ?? "chat");
  setIf(attributes, "gen_ai.request.model", input.model);
  if (isFiniteNumber(input.temperature)) setIf(attributes, "gen_ai.request.temperature", input.temperature);
  if (isFiniteNumber(input.topP)) setIf(attributes, "gen_ai.request.top_p", input.topP);
  if (isFiniteNumber(input.maxTokens)) setIf(attributes, "gen_ai.request.max_tokens", input.maxTokens);
  setIf(attributes, "gen_ai.response.model", input.responseModel);
  setIf(attributes, "gen_ai.response.id", input.responseId);
  if (Array.isArray(input.finishReasons) && input.finishReasons.length > 0) {
    attributes["gen_ai.response.finish_reasons"] = [...input.finishReasons];
  }
  if (isFiniteNumber(input.inputTokens)) attributes["gen_ai.usage.input_tokens"] = input.inputTokens;
  if (isFiniteNumber(input.outputTokens)) attributes["gen_ai.usage.output_tokens"] = input.outputTokens;
  setIf(attributes, "gen_ai.tool.name", input.tool);

  if (input.attributes) {
    for (const [key, value] of Object.entries(input.attributes)) {
      if (value !== undefined) attributes[key] = value;
    }
  }

  const summary: GenAiSummary = {};
  const summaryModel = input.model ?? input.responseModel;
  if (summaryModel !== undefined && summaryModel !== null && summaryModel !== "") summary.model = summaryModel;
  const hasInput = isFiniteNumber(input.inputTokens);
  const hasOutput = isFiniteNumber(input.outputTokens);
  if (hasInput || hasOutput) {
    summary.tokens = (hasInput ? (input.inputTokens as number) : 0) + (hasOutput ? (input.outputTokens as number) : 0);
  }
  if (isFiniteNumber(input.costUsd)) summary.costUsd = input.costUsd;
  if (isFiniteNumber(input.latencyMs)) summary.latencyMs = input.latencyMs;

  return { gen_ai: attributes, genai: summary };
}

/**
 * Return only the flat OpenTelemetry `gen_ai.*` attributes for a {@link GenAiInput} (no friendly summary).
 * Useful when feeding an OTel exporter that expects a flat attribute bag.
 */
export function genaiAttributes(input: GenAiInput = {}): GenAiAttributes {
  return genai(input).gen_ai;
}

/**
 * Return only the friendly {@link GenAiSummary} `{ model, tokens, costUsd, latencyMs }` for a {@link GenAiInput}.
 */
export function genaiSummary(input: GenAiInput = {}): GenAiSummary {
  return genai(input).genai;
}
