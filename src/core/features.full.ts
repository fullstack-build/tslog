import type { ILogObjMeta, IMeta, ISettings, ISettingsParam } from "../interfaces.js";
import { buildPrettyMeta } from "../internal/metaFormatting.js";
import { renderJson } from "../render/json.js";
import type { CoreFeatures, MaskingFeatureDeps, MaskingLike } from "./features.js";
import { MaskingEngine } from "./masking.js";
import { validateSettingsParam } from "./settings.js";

/**
 * The FULL {@link CoreFeatures} composition — masking, the precompiled JSON line renderer, settings
 * validation, and the pretty meta builder. Injected by every standard entry (node/browser/universal),
 * so `import { Logger } from "tslog"` behaves exactly as before the seam existed. Size-sensitive
 * entries (`tslog/slim`) compose their own reduced set instead of importing this module.
 */
export const fullCoreFeatures: CoreFeatures = {
  createMaskingEngine<LogObj>(settings: ISettings<LogObj>, deps: MaskingFeatureDeps): MaskingLike {
    return new MaskingEngine<LogObj>(settings, deps);
  },
  renderJson<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string {
    return renderJson(record, settings);
  },
  validateSettings<LogObj>(settings: ISettingsParam<LogObj> | undefined): void {
    validateSettingsParam(settings);
  },
  buildPrettyMetaText<LogObj>(settings: ISettings<LogObj>, meta: IMeta | undefined): string {
    return buildPrettyMeta(settings, meta).text;
  },
};
