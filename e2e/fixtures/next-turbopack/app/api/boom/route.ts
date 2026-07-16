import { Logger } from "tslog";
import { throwDeep } from "../../../lib/boom";

export async function GET(): Promise<Response> {
  const log = new Logger({ type: "hidden", stack: { capture: "full" } });

  let logObj: Record<string, unknown> | undefined;
  try {
    throwDeep();
  } catch (err) {
    logObj = log.error(err) as Record<string, unknown> | undefined;
  }

  const meta = logObj?._logMeta as Record<string, unknown> | undefined;
  const stack = (logObj?.stack ?? []) as Array<Record<string, unknown>>;

  return Response.json({
    callSitePath: meta?.path ?? null,
    errorFrames: stack.slice(0, 4).map((frame) => ({
      fileName: frame.fileName,
      filePathWithLine: frame.filePathWithLine,
    })),
  });
}
