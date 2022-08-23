import { Logger, ILogObject } from "tslog";
import { createStream } from "rotating-file-stream";

const stream = createStream("tslog.log", {
  size: "10M", // rotate every 10 MegaBytes written
  interval: "1d", // rotate daily
  compress: "gzip", // compress rotated files
});

function logToTransport(logObject: ILogObject) {
  stream.write(JSON.stringify(logObject) + "\n");
}

const logger: Logger = new Logger();
logger.attachTransport(
  {
    silly: logToTransport,
    debug: logToTransport,
    trace: logToTransport,
    info: logToTransport,
    warn: logToTransport,
    error: logToTransport,
    fatal: logToTransport,
  },
  "debug"
);

logger.debug("I am a debug log.");
logger.info("I am an info log.");
logger.warn("I am a warn log with a json object:", { foo: "bar" });
