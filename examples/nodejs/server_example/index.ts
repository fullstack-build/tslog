import { AsyncLocalStorage } from "async_hooks";
import Koa from "koa";
import { customAlphabet } from "nanoid";
import { Logger } from "../../../src";

interface ILogObj {
  requestId?: string | (() => string | undefined);
}

const asyncLocalStorage: AsyncLocalStorage<{ requestId: string }> = new AsyncLocalStorage();

const defaultLogObject: ILogObj = {
  requestId: () => asyncLocalStorage.getStore()?.requestId,
};

const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
export { logger };

logger.info("Test log without requestId");

const koaApp = new Koa();

/** START AsyncLocalStorage requestId middleware **/
koaApp.use(async (ctx: Koa.Context, next: Koa.Next) => {
  // use x-request-id or fallback to a nanoid
  const requestId: string = (ctx.request.headers["x-request-id"] as string) ?? customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 6)();
  // every other Koa middleware will run within the AsyncLocalStorage context
  await asyncLocalStorage.run({ requestId }, async () => {
    return next();
  });
});
/** END AsyncLocalStorage requestId middleware **/

// example middleware
koaApp.use(async (ctx: Koa.Context, next) => {
  // log request
  logger.silly({ originalUrl: ctx.originalUrl, status: ctx.response.status, message: ctx.response.message });
  // also works with a sub logger
  const subLogger = logger.getSubLogger();
  subLogger.info("Log containing requestId"); // <-- will contain a requestId

  return await next();
});

koaApp.listen(3000);

logger.info("Server running on port 3000");
