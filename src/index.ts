import { BaseLogger, ISettingsParam, ILogObj, ISettings } from "./BaseLogger.js";
export { ISettingsParam, BaseLogger, ILogObj };


export declare class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettings<LogObj>, logObj?: LogObj);
}
