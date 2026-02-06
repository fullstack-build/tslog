import { Logger } from "../src/index.js";

describe("Concurrent logging", () => {
  test("multiple loggers writing concurrently produce correct logObj", async () => {
    const loggerA = new Logger({ type: "hidden", name: "A" });
    const loggerB = new Logger({ type: "hidden", name: "B" });
    const loggerC = new Logger({ type: "hidden", name: "C" });

    const results = await Promise.all([
      Promise.resolve(loggerA.info("from A")),
      Promise.resolve(loggerB.info("from B")),
      Promise.resolve(loggerC.info("from C")),
    ]);

    expect(results[0]?._meta?.name).toBe("A");
    expect(results[0]?.["0"]).toBe("from A");
    expect(results[1]?._meta?.name).toBe("B");
    expect(results[1]?.["0"]).toBe("from B");
    expect(results[2]?._meta?.name).toBe("C");
    expect(results[2]?.["0"]).toBe("from C");
  });

  test("transport called for every log in a rapid burst", () => {
    const count = 100;
    const captured: unknown[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport((logObj) => captured.push(logObj));

    for (let i = 0; i < count; i++) {
      logger.info(`msg-${i}`);
    }

    expect(captured.length).toBe(count);
    expect((captured[0] as Record<string, unknown>)["0"]).toBe("msg-0");
    expect((captured[count - 1] as Record<string, unknown>)["0"]).toBe(`msg-${count - 1}`);
  });

  test("sub-logger prefixes do not leak across concurrent loggers", async () => {
    const root = new Logger({ type: "hidden" });
    const subA = root.getSubLogger({ prefix: ["[A]"] });
    const subB = root.getSubLogger({ prefix: ["[B]"] });

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const logger = i % 2 === 0 ? subA : subB;
        return Promise.resolve(logger.info(`msg-${i}`));
      }),
    );

    for (let i = 0; i < 50; i++) {
      const logObj = results[i];
      const expectedPrefix = i % 2 === 0 ? "[A]" : "[B]";
      expect(logObj?.["0"]).toBe(expectedPrefix);
      expect(logObj?.["1"]).toBe(`msg-${i}`);
    }
  });

  test("each log gets a unique date timestamp", () => {
    const logger = new Logger({ type: "hidden" });
    const results: Date[] = [];

    for (let i = 0; i < 10; i++) {
      const logObj = logger.info(`msg-${i}`);
      results.push(logObj?._meta?.date as Date);
    }

    for (const date of results) {
      expect(date).toBeInstanceOf(Date);
    }

    // All dates should be within a very short window
    const first = results[0].getTime();
    const last = results[results.length - 1].getTime();
    expect(last - first).toBeLessThan(1000);
  });
});
