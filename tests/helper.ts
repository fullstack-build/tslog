import { ILogObject, Logger } from "../src";

export interface IContext {
  logger: Logger;
  stdOut: string[];
  stdErr: string[];
  transportOut?: ILogObject[];
  transportErr?: ILogObject[];
}

export const doesLogContain: (std: string[], str: string) => boolean = (
  std: string[],
  str: string
) => {
  return std.find((element: string) => element.indexOf(str) > -1) != null;
};
