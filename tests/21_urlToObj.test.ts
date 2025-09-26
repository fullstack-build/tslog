import "ts-jest";
import { urlToObject } from "../src/urlToObj.js";

describe("urlToObject", () => {
  test("converts URL properties and search params", () => {
    const url = new URL("https://user:pass@example.com:8080/path?a=1&b=two#hash");
    const result = urlToObject(url);

    expect(result).toMatchObject({
      href: url.href,
      protocol: "https:",
      username: "user",
      password: "pass",
      host: "example.com:8080",
      hostname: "example.com",
      port: "8080",
      pathname: "/path",
      search: "?a=1&b=two",
      hash: "#hash",
      origin: "https://example.com:8080",
    });
    expect(result.searchParams).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "two" },
    ]);
  });
});
