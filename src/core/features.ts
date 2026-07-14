import type { ILogObjMeta, IMeta, ISettings, ISettingsParam } from "../interfaces.js";

/**
 * `core/features.ts` — the build-time composition seam for the runtime-AGNOSTIC subsystems.
 *
 * The {@link import("../env/environment.js").EnvironmentProvider} seam (BC11) lets each entry inject the
 * runtime-SPECIFIC pieces (stack parsing, inspect, console targets). This seam does the same for the
 * pieces that do not vary by runtime but DO vary by how much of tslog a build wants to ship: masking,
 * the precompiled JSON line renderer, settings validation, and the pretty meta builder. `BaseLogger`
 * never imports those modules directly — it consumes whatever the entry composes here — so a
 * size-sensitive entry (`tslog/slim`) can leave subsystems out and a bundler tree-shakes them away.
 *
 * The standard entries (`tslog`, node/browser/universal) all inject the full set from
 * `./features.full.js`; only alternative entries compose differently.
 *
 * This module is TYPE-ONLY at runtime (no value imports), so importing it costs nothing.
 */

/** The subset of the masking engine `BaseLogger` consumes. */
export interface MaskingLike {
  /** Mask one log call's argument array, returning the masked (possibly cloned) array. */
  mask(args: unknown[]): unknown[];
}

/** The predicates the masking engine needs from the runtime (mirrors `MaskingPredicates`). */
export interface MaskingFeatureDeps {
  isError(value: unknown): value is Error;
  isBuffer(value: unknown): boolean;
}

/** The runtime-agnostic feature set an entry injects into `BaseLogger`. */
export interface CoreFeatures {
  /**
   * Build the masking engine for a logger (called once per logger with its resolved settings).
   * Absent → identity masking: args pass through untouched and `mask` settings have no effect
   * (entries that omit this must reject `mask` settings in {@link validateSettings} instead of
   * silently skipping redaction).
   */
  createMaskingEngine?<LogObj>(settings: ISettings<LogObj>, deps: MaskingFeatureDeps): MaskingLike;
  /**
   * Render a finished record to its JSON line. The standard entries inject the precompiled line-plan
   * renderer (`render/json.js` `renderJson`); slim entries inject the plan-free `renderJsonUnplanned`
   * (byte-identical output, smaller bundle).
   */
  renderJson<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string;
  /**
   * Validate the RAW (pre-normalize) settings: development warnings and `strictConfig` throws.
   * Absent → validation is skipped entirely.
   */
  validateSettings?<LogObj>(settings: ISettingsParam<LogObj> | undefined): void;
  /**
   * Build the pretty console line's meta markup (the standard entries pass `buildPrettyMeta(...).text`).
   * Absent → the live pretty console path renders no meta prefix (entries without the pretty subsystem
   * reject `type: "pretty"` in {@link validateSettings}, so this only matters as a defensive fallback).
   */
  buildPrettyMetaText?<LogObj>(settings: ISettings<LogObj>, meta: IMeta | undefined): string;
}
