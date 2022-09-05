(() => {
  const defaultLogObject = {
    name: "example.js",
  };

  const logger = new tslog.Logger({}, defaultLogObject);

  logger.silly("silly huhu", { haha: true, password: "123456" }, ["SECRET"]);
  logger.trace("trace huhu", { haha: true });
  logger.debug("debug huhu", { haha: true });
  logger.info("info huhu", { haha: true });
  logger.warn("warn huhu", { haha: true });
  logger.error("error huhu", { haha: true });
  logger.fatal("fatal huhu", { haha: true });

  logger.fatal({ onlyOne: true });

  logger.fatal("test1 %s test3", "test2");

  console.log("###############");

  const baseLogger = new tslog.BaseLogger({}, defaultLogObject);

  baseLogger.log(0, "test", "test base logger", { haha: true, password: "123456" }, ["SECRET"]);
})();
