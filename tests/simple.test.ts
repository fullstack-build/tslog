import ava, { ExecutionContext } from "ava";
import { Logger } from "../src/index";

ava("init logger", (test: ExecutionContext<unknown>): void => {
  const logger = new Logger();
  test.deepEqual(logger instanceof Logger, true);
});
