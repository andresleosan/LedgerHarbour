/**
 * Pounds sterling as integer pence. No floating point ever touches an amount.
 *
 * ponytail: safe integers (`number`), not BigInt. The largest numeric(14,2) value,
 * 999999999999.99, is 99_999_999_999_999 pence, two orders of magnitude below
 * Number.MAX_SAFE_INTEGER, so every stored amount is exact as a number and stays
 * JSON-friendly. Only a sum could leave the safe range; `sumPence` refuses then.
 */
export const MAX_PENCE = 99_999_999_999_999;

const POUNDS = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Parses "123.45", "-0.5" or "7" into pence; rejects any other shape. */
export function parsePounds(text: string): number {
  const match = typeof text === "string" ? POUNDS.exec(text) : null;
  if (!match) throw new RangeError("Amount must be pounds with at most two decimals.");
  const [, sign, pounds, fraction = ""] = match;
  const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  return sign && pence !== 0 ? -pence : pence;
}

export function formatPence(pence: number): string {
  if (!Number.isSafeInteger(pence) || Math.abs(pence) > MAX_PENCE) throw new RangeError("Pence must be an integer within numeric(14,2).");
  const absolute = Math.abs(pence);
  return `${pence < 0 ? "-" : ""}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function sumPence(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total)) throw new RangeError("Sum of pence left the exact range.");
  }
  return total;
}
