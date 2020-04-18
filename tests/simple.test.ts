import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger } from "../src/index";

interface IContext {
  plainLogger: Logger;
  namedLogger: Logger;
}

const test = ava as TestInterface<IContext>;

test.before((test: ExecutionContext<IContext>) => {
  test.context = {
    plainLogger: new Logger(),
    namedLogger: new Logger({ name: "Test" }),
  };
});
test.after.always((test: ExecutionContext<IContext>) => {});
test.after((test: ExecutionContext<IContext>) => {});

test("init plain logger", (test: ExecutionContext<IContext>): void => {
  test.deepEqual(test.context.plainLogger instanceof Logger, true);
});

test("init named logger", (test: ExecutionContext<IContext>): void => {
  test.deepEqual(test.context.namedLogger instanceof Logger, true);
  test.deepEqual(test.context.namedLogger.settings.name, "Test");
});
