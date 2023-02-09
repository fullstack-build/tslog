import { BaseLogger, ILogObj, ISettingsParam, Logger as AgnosticLogger } from "./index";
import BrowserRuntime from "./runtime/browser/index";

export { ISettingsParam, BaseLogger, ILogObj };

export class Logger<LogObj> extends AgnosticLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    super(BrowserRuntime, settings, logObj);
  }
}