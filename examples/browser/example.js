(() => {
  const defaultLogObject = {
    name: "example.js",
  };

  const logger = new tslog.Logger({ type: "pretty" }, defaultLogObject);

  logger.silly("silly foo", { bar: true, password: "123456" }, ["SECRET"]);
  logger.trace("trace foo", { bar: true });
  logger.debug("debug foo", { bar: true });
  logger.info("info foo", { bar: true });
  logger.warn("warn foo", { bar: true });
  logger.error("error foo", { bar: true });
  logger.fatal("fatal foo", { bar: true });

  logger.fatal({ onlyOne: true });

  logger.fatal("test1 %s test3", "test2");

  console.log("###############");

  const baseLogger = new tslog.BaseLogger({}, defaultLogObject);

  baseLogger.log(0, "test", "test base logger", { foo: true, password: "123456" }, ["SECRET"]);

  logger.fatal("test error", new Error("test example.js"));

  logger.silly("Foo %s", "bar");
})();
