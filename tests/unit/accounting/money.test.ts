import { describe, expect, it } from "vitest";

import { MAX_PENCE, formatPence, parsePounds, sumPence } from "../../../src/modules/accounting/money";

describe("money in exact pence", () => {
  it.each([
    ["0", 0],
    ["0.1", 10],
    ["0.2", 20],
    ["0.30", 30],
    ["-0.01", -1],
    ["19.99", 1999],
    ["-1234.5", -123450],
    ["007.05", 705],
    ["-0.00", 0],
    ["999999999999.99", MAX_PENCE],
    ["-999999999999.99", -MAX_PENCE],
  ])("parses %s as %i pence", (text, pence) => {
    expect(parsePounds(text)).toBe(pence);
  });

  it.each(["", " 5 ", "5 ", "1.005", "1e3", "1E3", "1,000.00", "+5", "5.", ".5", "--5", "0x10", "Infinity", "NaN", "1 000", "£5", "1000000000000.00", "9999999999999"])(
    "rejects %j",
    (text) => {
      expect(() => parsePounds(text)).toThrow(RangeError);
    },
  );

  it.each([5, null, undefined, BigInt(5), {}])("rejects non-string input %#", (value) => {
    expect(() => parsePounds(value as never)).toThrow(RangeError);
  });

  it("adds 0.1 and 0.2 to exactly 0.30", () => {
    expect(formatPence(sumPence([parsePounds("0.1"), parsePounds("0.2")]))).toBe("0.30");
  });

  it("sums 19.99 ten thousand times to the exact pence", () => {
    const total = sumPence(Array.from({ length: 10_000 }, () => parsePounds("19.99")));
    expect(total).toBe(19_990_000);
    expect(formatPence(total)).toBe("199900.00");
  });

  it("sums mixed signs to zero exactly", () => {
    expect(formatPence(sumPence(["100.10", "-33.37", "-33.37", "-33.36"].map(parsePounds)))).toBe("0.00");
  });

  it.each([0, 1, -1, 10, -10, 1999, -123450, MAX_PENCE, -MAX_PENCE])("round-trips %i pence through text", (pence) => {
    expect(parsePounds(formatPence(pence))).toBe(pence);
  });

  it("formats with exactly two decimals and a leading minus", () => {
    expect(formatPence(0)).toBe("0.00");
    expect(formatPence(-1)).toBe("-0.01");
    expect(formatPence(105)).toBe("1.05");
    expect(formatPence(-123450)).toBe("-1234.50");
  });

  it.each([0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, BigInt(5)])("refuses to format a non-integer %#", (value) => {
    expect(() => formatPence(value as never)).toThrow(RangeError);
  });

  it("refuses a sum that leaves the safe integer range", () => {
    expect(() => sumPence(Array.from({ length: 100 }, () => MAX_PENCE))).toThrow(RangeError);
  });
});
