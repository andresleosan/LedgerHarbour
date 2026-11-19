import { describe, expect, it } from "vitest";

import { invoiceNarrative, shareDebit } from "../../../src/modules/invoices/payment-shares";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("shareDebit", () => {
  it("keeps each line's own amount when the debit equals the total", () => {
    expect(shareDebit([10_000, 2_000], 12_000)).toEqual([10_000, 2_000]);
    expect(shareDebit([12_000], 12_000)).toEqual([12_000]);
  });

  it("gives a single line the whole debit", () => {
    expect(shareDebit([12_000], 9_876)).toEqual([9_876]);
    expect(shareDebit([1], 99_999_999_999_999)).toEqual([99_999_999_999_999]);
  });

  it("scales in proportion, rounding down, and gives the leftover pence to the largest line", () => {
    // 100.00 + 20.00 of 120.00 debited as 100.00: 83.333… and 16.666… → 83.33 and 16.66, 1p left over to the 100.00 line.
    expect(shareDebit([10_000, 2_000], 10_000)).toEqual([8_334, 1_666]);
    // Three equal lines of 1.00 debited as 1.00: 33p each and 1p left over to the first of the tied largest.
    expect(shareDebit([100, 100, 100], 100)).toEqual([34, 33, 33]);
    // The largest line is not the first one.
    expect(shareDebit([100, 300, 100], 1_000)).toEqual([200, 600, 200]);
  });

  it("puts the leftover on the largest line, not the first", () => {
    // 1001/501 of each: 201.8→201, 599.4→599, 199.8→199; 2p left over go to the 300 line.
    expect(shareDebit([101, 300, 100], 1_001)).toEqual([201, 601, 199]);
    const leftover = shareDebit([1, 2, 4], 10);
    // 10/7 of each: 1.42→1, 2.85→2, 5.71→5; 2p left over go to the 4p line.
    expect(leftover).toEqual([1, 2, 7]);
  });

  it("handles tiny amounts where rounding bites, even leaving a line at zero", () => {
    expect(shareDebit([1, 999], 1)).toEqual([0, 1]);
    expect(shareDebit([50, 50], 1)).toEqual([1, 0]);
    expect(shareDebit([1, 1, 1], 2)).toEqual([2, 0, 0]);
  });

  it("scales up as well as down and never loses or invents a penny", () => {
    const lines = [3_333, 3_333, 3_334, 17, 1];
    for (const debited of [1, 7, 99, 10_018, 10_019, 54_321, 99_999_999_999]) {
      const shares = shareDebit(lines, debited);
      expect(sum(shares), String(debited)).toBe(debited);
      expect(shares.every((share) => Number.isSafeInteger(share) && share >= 0), String(debited)).toBe(true);
    }
  });

  it("stays exact for the largest amounts numeric(14,2) can hold", () => {
    const shares = shareDebit([99_999_999_999_998, 1], 99_999_999_999_999 - 7);
    expect(sum(shares)).toBe(99_999_999_999_992);
    expect(shares[1]).toBe(0);
  });

  it("refuses lines or debits that are not positive whole pence", () => {
    expect(() => shareDebit([], 100)).toThrow(RangeError);
    expect(() => shareDebit([100], 0)).toThrow(RangeError);
    expect(() => shareDebit([100, 0], 100)).toThrow(RangeError);
    expect(() => shareDebit([100.5], 100)).toThrow(RangeError);
  });
});

describe("invoiceNarrative", () => {
  it("is the supplier and the invoice number, trimmed", () => {
    expect(invoiceNarrative(" Acme Ltd ", " INV-42 ")).toBe("Acme Ltd INV-42");
  });

  it("falls back to the supplier only, the number only, then a neutral word", () => {
    expect(invoiceNarrative("Acme Ltd", "  ")).toBe("Acme Ltd");
    expect(invoiceNarrative(null, "INV-42")).toBe("INV-42");
    expect(invoiceNarrative(" ", null)).toBe("Invoice");
  });

  it("is cut to 200 characters without a trailing space", () => {
    const narrative = invoiceNarrative(`${"a".repeat(199)} b`, "INV-42");
    expect(narrative).toBe("a".repeat(199));
    expect(invoiceNarrative("s".repeat(300), "1")).toHaveLength(200);
  });
});
