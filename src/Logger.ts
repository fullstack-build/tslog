import { wrapCallSite } from "source-map-support";
import { ISettings, ISettingsParam } from ".";
import { LoggerWithoutCallSite } from "./LoggerWithoutCallSite";

/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
export class Logger extends LoggerWithoutCallSite {
  /**
   * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
   * @param parentSettings - Used internally to
   */
  public constructor(settings?: ISettingsParam, parentSettings?: ISettings) {
    super(settings, parentSettings);
    this._callSiteWrapper = wrapCallSite;
  }
}
