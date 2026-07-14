import { beforeEach } from "vitest";

/**
 * IDE/CI harnesses often export NO_COLOR=1. That is correct production precedence, but it would
 * override browser-default `pretty.style` in Node tests that stub DOM globals to exercise the CSS `%c`
 * path. Suites that assert NO_COLOR behavior set it explicitly inside the test.
 */
beforeEach(() => {
  delete process.env.NO_COLOR;
});
