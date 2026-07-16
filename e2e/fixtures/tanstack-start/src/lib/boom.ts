// Line numbers matter: the E2E asserts the throw resolves to src/lib/boom.ts:4.
export function throwDeep(): never {
  const reason = "kaboom from src/lib/boom.ts";
  throw new Error(reason);
}
