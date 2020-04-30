const tslog = require("../dist");

const log = new tslog.Logger();

try {
  null.f();
} catch (err) {
  log.warn(err);
}
