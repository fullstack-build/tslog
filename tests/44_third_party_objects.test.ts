import { ObjectId } from "bson";
import { GraphQLError } from "graphql";
import { Logger } from "../src/index.js";

// Regression tests for crashes when logging third-party objects with hostile shapes:
// - #269: GraphQLError sets `extensions` to a null-prototype object, which broke String()/join().
// - #271: BSON ObjectId has a throwing [util.inspect.custom] that broke pretty formatting.
// Both are exercised with the real packages so the fixes are locked against the actual types.

describe("#269: logging a GraphQLError does not throw", () => {
  test("pretty mode formats a GraphQLError without crashing", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = new Logger({ type: "pretty" });
    expect(() => logger.error(new GraphQLError("Error in your graphql server"))).not.toThrow();
    // GraphQLError.extensions is created via Object.create(null); ensure the populated form is also safe.
    expect(() => logger.error(new GraphQLError("with extensions", { extensions: { code: "BAD_USER_INPUT" } }))).not.toThrow();
    consoleSpy.mockRestore();
  });

  test("json mode captures the GraphQLError as a structured error", () => {
    const logger = new Logger({ type: "hidden" });
    // A single error arg is spread into the log object as a structured error (name/message/stack/nativeError).
    const out = logger.error(new GraphQLError("graphql failure")) as { name?: string; message?: string };
    expect(out?.name).toBe("GraphQLError");
    expect(out?.message).toBe("graphql failure");
  });
});

describe("#271: logging BSON ObjectId values does not throw", () => {
  test("an ObjectId nested in an object/array logs in pretty mode", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logger = new Logger({ type: "pretty" });
    const docs = [{ _id: new ObjectId("6527b62b25dd80f72d955468"), namespace: "local" }];
    expect(() => logger.info("list objects", docs)).not.toThrow();
    consoleSpy.mockRestore();
  });

  test("json mode serializes an object containing an ObjectId", () => {
    const logger = new Logger({ type: "hidden" });
    const out = logger.info({ _id: new ObjectId("6527b62b25dd80f72d955468"), namespace: "local" });
    const serialized = JSON.stringify(out);
    expect(serialized).toContain("6527b62b25dd80f72d955468");
    expect(serialized).toContain("local");
  });
});
