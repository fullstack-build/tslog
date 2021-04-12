/// <reference types="node" />
declare const callsitesSym: symbol;
export { callsitesSym };
export declare function FormatStackTrace(error: Error, frames: NodeJS.CallSite[]): string;
export declare function getCallSites(err: Error): NodeJS.CallSite[];
