import type { IPrettyLogStyles, ISettings, TStyle } from "./interfaces.js";
import { styleTokenToSgr } from "./render/styles.js";

export function formatTemplate<LogObj>(settings: ISettings<LogObj>, template: string, values: Record<string, string | number>, hideUnsetPlaceholder = false) {
  const templateString = String(template);
  const ansiColorWrap = (placeholderValue: string, code: [string | number, string | number]) => `\u001b[${code[0]}m${placeholderValue}\u001b[${code[1]}m`;

  const styleWrap: (value: string, style: TStyle) => string = (value: string, style: TStyle) => {
    if (style != null && typeof style === "string") {
      // A named palette token or a hex color; an unknown token leaves the value unstyled.
      const sgr = styleTokenToSgr(style);
      return sgr != null ? ansiColorWrap(value, sgr) : value;
    } else if (style != null && Array.isArray(style)) {
      return style.reduce((prevValue: string, thisStyle: string) => styleWrap(prevValue, thisStyle), value);
    } else {
      if (style != null && style[value.trim()] != null) {
        return styleWrap(value, style[value.trim()]);
      } else if (style != null && style["*"] != null) {
        return styleWrap(value, style["*"]);
      } else {
        return value;
      }
    }
  };

  const defaultStyle: TStyle = null;
  return templateString.replace(/{{(.+?)}}/g, (_, placeholder) => {
    const value = values[placeholder] != null ? String(values[placeholder]) : hideUnsetPlaceholder ? "" : _;
    return settings.pretty.style
      ? styleWrap(value, settings.pretty.styles?.[placeholder as keyof IPrettyLogStyles] ?? defaultStyle) + ansiColorWrap("", [0, 0])
      : value;
  });
}
