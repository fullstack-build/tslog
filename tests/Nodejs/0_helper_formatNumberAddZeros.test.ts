import "ts-jest";
import { formatNumberAddZeros } from "../../src/formatNumberAddZeros";

describe("Format Number: Add missing Zeros", () => {
  test("NaN", (): void => {
    const result = formatNumberAddZeros(NaN, NaN);
    expect(result).toBe("");
  });

  test("0, 2", (): void => {
    const result = formatNumberAddZeros(0, 2);
    expect(result).toBe("00");
  });

  test("1, 2", (): void => {
    const result = formatNumberAddZeros(1, 2);
    expect(result).toBe("01");
  });

  test("9, 2", (): void => {
    const result = formatNumberAddZeros(9, 2);
    expect(result).toBe("09");
  });

  test("10, 2", (): void => {
    const result = formatNumberAddZeros(10, 2);
    expect(result).toBe("10");
  });

  test("99, 2", (): void => {
    const result = formatNumberAddZeros(99, 2);
    expect(result).toBe("99");
  });

  test("100, 2", (): void => {
    const result = formatNumberAddZeros(100, 2);
    expect(result).toBe("100");
  });

  test("0, 3", (): void => {
    const result = formatNumberAddZeros(0, 3);
    expect(result).toBe("000");
  });

  test("1, 3", (): void => {
    const result = formatNumberAddZeros(1, 3);
    expect(result).toBe("001");
  });

  test("9, 3", (): void => {
    const result = formatNumberAddZeros(9, 3);
    expect(result).toBe("009");
  });

  test("10, 3", (): void => {
    const result = formatNumberAddZeros(10, 3);
    expect(result).toBe("010");
  });

  test("99, 3", (): void => {
    const result = formatNumberAddZeros(99, 3);
    expect(result).toBe("099");
  });

  test("100, 3", (): void => {
    const result = formatNumberAddZeros(100, 3);
    expect(result).toBe("100");
  });

  test("100, 3, 4", (): void => {
    const result = formatNumberAddZeros(100, 3, 4);
    expect(result).toBe("104");
  });
});
