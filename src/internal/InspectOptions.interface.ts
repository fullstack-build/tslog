export interface InspectOptions {
  /**
   * If set to `true`, getters are going to be
   * inspected as well. If set to `'get'` only getters without setter are going
   * to be inspected. If set to `'set'` only getters having a corresponding
   * setter are going to be inspected. This might cause side effects depending on
   * the getter function.
   * @default `false`
   */
  getters?: "get" | "set" | boolean | undefined;
  showHidden?: boolean | undefined;
  /**
   * @default 2
   */
  depth?: number | null | undefined;
  colors?: boolean | undefined;
  customInspect?: boolean | undefined;
  showProxy?: boolean | undefined;
  maxArrayLength?: number | null | undefined;
  /**
   * Specifies the maximum number of characters to
   * include when formatting. Set to `null` or `Infinity` to show all elements.
   * Set to `0` or negative to show no characters.
   * @default 10000
   */
  maxStringLength?: number | null | undefined;
  breakLength?: number | undefined;
  /**
   * Setting this to `false` causes each object key
   * to be displayed on a new line. It will also add new lines to text that is
   * longer than `breakLength`. If set to a number, the most `n` inner elements
   * are united on a single line as long as all properties fit into
   * `breakLength`. Short array elements are also grouped together. Note that no
   * text will be reduced below 16 characters, no matter the `breakLength` size.
   * For more information, see the example below.
   * @default `true`
   */
  compact?: boolean | number | undefined;
  sorted?: boolean | ((a: string, b: string) => number) | undefined;
}
