import { ISettings, TStyle, IPrettyLogStyles } from "./interfaces.js";
import { prettyLogStyles } from "./prettyLogStyles.js";

export function formatTemplate<LogObj>(settings: ISettings<LogObj>, template: string, values: Record<string, string | number>, hideUnsetPlaceholder = false) {
  const templateString = String(template);
  const ansiColorWrap = (placeholderValue: string, code: [number, number]) => `\u001b[${code[0]}m${placeholderValue}\u001b[${code[1]}m`;

  const styleWrap: (value: string, style: TStyle) => string = (value: string, style: TStyle) => {
    if (style != null && typeof style === "string") {
      return ansiColorWrap(value, prettyLogStyles[style]);
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
    return settings.stylePrettyLogs
      ? styleWrap(value, settings?.prettyLogStyles?.[placeholder as keyof IPrettyLogStyles] ?? defaultStyle) + ansiColorWrap("", prettyLogStyles.reset)
      : value;
  });
}
