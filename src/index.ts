/**
 * Expressive TypeScript Logger for Node.js
 * @packageDocumentation
 */

export {
  ILogLevel,
  TTransportLogger,
  ILogObject,
  ILogObjectStringifiable,
  IErrorObject,
  IErrorObjectStringifiable,
  IStackFrame,
  ISettingsParam,
  IStd,
  TLogLevelName,
  TRequestIdFunction,
  TLogLevelId,
  IHighlightStyles,
  TLogLevelColor,
  TUtilsInspectColors,
  ISettings,
  ICodeFrame,
} from "./interfaces";

export { Logger } from "./Logger";
export { LoggerWithoutCallSite } from "./LoggerWithoutCallSite";
