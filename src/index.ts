import { BaseLogger, ISettingsParam, ILogObj, ISettings } from "./BaseLogger.js";
export { ISettingsParam, BaseLogger, ILogObj };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettings<LogObj>, logObj?: LogObj);
}
