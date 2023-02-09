import { BaseLogger, ISettingsParam, ILogObj } from "./BaseLogger.js";
export { ISettingsParam, BaseLogger, ILogObj };


export declare class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj);
}
