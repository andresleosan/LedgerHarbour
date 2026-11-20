/**
 * Splits the pence the bank debited over an invoice's coding lines.
 *
 * When the debit equals the lines' total each line keeps its own amount. Otherwise each line gets
 * its proportional share rounded down, and the pence left over go to the largest line (the first of
 * equals), so the shares always add up to `debitedPence` exactly. A tiny debit can leave a line at 0.
 */
export function shareDebit(linePence: readonly number[], debitedPence: number): number[] {
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (linePence.length === 0 || !linePence.every(positive) || !positive(debitedPence)) {
    throw new RangeError("Lines and the debit must be positive whole pence.");
  }
  const total = linePence.reduce((sum, value) => sum + value, 0);
  if (total === debitedPence) return [...linePence];
  // BigInt: line × debit can exceed the exact range of a number for large amounts.
  const shares = linePence.map((value) => Number((BigInt(value) * BigInt(debitedPence)) / BigInt(total)));
  const largest = linePence.indexOf(Math.max(...linePence));
  shares[largest] += debitedPence - shares.reduce((sum, value) => sum + value, 0);
  return shares;
}

const MAX_NARRATIVE = 200;

/** A movement's narrative for an invoice: "supplier number", either alone, or "Invoice" when both are blank. */
export function invoiceNarrative(supplier: string | null, invoiceNumber: string | null): string {
  const text = [supplier, invoiceNumber].map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || "Invoice";
  return text.slice(0, MAX_NARRATIVE).trimEnd();
}
