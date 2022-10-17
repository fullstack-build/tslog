export function formatNumberAddZeros(value: number, digits = 2, addNumber = 0): string {
  if (value != null && isNaN(value)) {
    return "";
  }
  value = value != null ? value + addNumber : value;
  return digits === 2
    ? value == null
      ? "--"
      : value < 10
      ? "0" + value
      : value.toString()
    : value == null
    ? "---"
    : value < 10
    ? "00" + value
    : value < 100
    ? "0" + value
    : value.toString();
}
