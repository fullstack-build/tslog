import { ISettings, ISettingsParam } from ".";
import { LoggerWithoutCallSite } from "./LoggerWithoutCallSite";
/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
export declare class Logger extends LoggerWithoutCallSite {
  /**
   * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
   * @param parentSettings - Used internally to
   */
  constructor(settings?: ISettingsParam, parentSettings?: ISettings);
}
