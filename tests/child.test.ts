import "ts-jest";
import { IErrorObject, ILogObject, Logger } from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
  name: "MainLogger",
  prefix: ["parent"],
  type: "json",
  stdOut: {
    write: (print: string) => {
      stdOut.push(print);
    },
  },
  stdErr: {
    write: (print: string) => {
      stdErr.push(print);
    },
  },
});

describe("Logger: Child", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("Playbook: Parent with prefix, one child with prefix, one grandchild with prefix, changing settings (prefix & name) during runtime (json -> stdOut)", (): void => {
    logger.silly("test parent message");
    const parentLog: ILogObject = JSON.parse(stdOut[0]);
    expect(parentLog.loggerName).toBe("MainLogger");
    expect(parentLog.argumentsArray[0]).toBe("parent");

    const child1: Logger = logger.getChildLogger({
      name: "FirstChild",
      prefix: ["child1"],
    });
    child1.silly("test child1 message");

    const child1Log: ILogObject = JSON.parse(stdOut[1]);
    expect(child1Log.loggerName).toBe("FirstChild");
    expect(child1Log.argumentsArray[0]).toBe("parent");
    expect(child1Log.argumentsArray[1]).toBe("child1");

    const grandchild1: Logger = child1.getChildLogger({
      name: "GrandChild",
      prefix: ["child1-1", "grandchild1"],
    });
    grandchild1.silly("test grandchild1 message");

    const grandchild1Log: ILogObject = JSON.parse(stdOut[2]);
    expect(grandchild1Log.loggerName).toBe("GrandChild");
    expect(grandchild1Log.argumentsArray[0]).toBe("parent");
    expect(grandchild1Log.argumentsArray[1]).toBe("child1");
    expect(grandchild1Log.argumentsArray[2]).toBe("child1-1");
    expect(grandchild1Log.argumentsArray[3]).toBe("grandchild1");

    logger.setSettings({ name: "OtherName", prefix: ["renamedParent"] });
    logger.silly("test grandchild1 message");
    grandchild1.silly("test grandchild1 message");
    const parentLog2: ILogObject = JSON.parse(stdOut[3]);
    const grandchild1Log2: ILogObject = JSON.parse(stdOut[4]);

    expect(parentLog2.loggerName).toBe("OtherName");
    expect(grandchild1Log2.loggerName).toBe("GrandChild");
    expect(grandchild1Log2.argumentsArray[0]).toBe("renamedParent");
    expect(grandchild1Log2.argumentsArray[1]).toBe("child1");
    expect(grandchild1Log2.argumentsArray[2]).toBe("child1-1");
    expect(grandchild1Log2.argumentsArray[3]).toBe("grandchild1");
  });
});
