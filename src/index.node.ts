import { BaseLogger, ILogObj, ISettingsParam, Logger as AgnosticLogger } from "./index";
import NodeRuntime from "./runtime/nodejs/index";

export { ISettingsParam, BaseLogger, ILogObj };

export class Logger<LogObj> extends AgnosticLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    super(NodeRuntime, settings, logObj);
  }
}