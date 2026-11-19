import type { AnnexAssetLine, AnnexInvoice, AnnexTotal, YearAnnex } from "./annex-service";
import { formatPence, parsePounds } from "./money";

// The closing annex as one RFC 4180 CSV: UTF-8 with a BOM, CRLF line ends. Supplier names
// and narratives come from users and OCR, so a text cell that a spreadsheet would read as a
// formula is prefixed with an apostrophe. The amount column is always a plain number.

const HEADER = ["section", "date", "name", "reference", "detail", "amount", "currency"];
const FORMULA_START = /^[=+\-@\t\r]/;

/** date, name, reference, detail; then the amount and its currency. */
type Row = { cells: [string, string, string, string]; amount: string | null; currency: string };

const text = (value: string) => {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (section: string, row: Row) =>
  [...[section, ...row.cells].map(text), row.amount === null ? "" : formatPence(parsePounds(row.amount)), text(row.currency)].join(",");

const invoiceRows = (items: AnnexInvoice[]): Row[] => items.map((i) => ({
  cells: [i.invoiceDate ?? "", i.supplier ?? "", i.invoiceNumber ?? "", [i.kind === "credit_note" && "Credit note", i.undated && "Undated"].filter(Boolean).join("; ")], amount: i.total, currency: i.currency ?? "",
}));
const assetRows = (items: AnnexAssetLine[]): Row[] => items.map((a) => ({ cells: [a.date, a.narrative, a.accountName, a.headingName], amount: a.amount, currency: "GBP" }));
/** One row per currency; an empty section still gets a zero total. */
const totalRows = (totals: AnnexTotal): Row[] => (totals.byCurrency.length ? totals.byCurrency : [{ currency: "GBP", count: 0, amount: "0.00" }])
  .map((t) => ({ cells: ["", "Total", "", `${t.count} ${t.count === 1 ? "item" : "items"}`], amount: t.amount, currency: t.currency }));

export function annexCsv(annex: YearAnnex): string {
  const { year, totals } = annex;
  const sections: Array<[string, Row[], AnnexTotal]> = [
    ["Unpaid at year end", invoiceRows(annex.unpaidInvoices), totals.unpaidInvoices],
    ["Paid with private money", invoiceRows(annex.privatelyPaidInvoices), totals.privatelyPaidInvoices],
    ["Fixed asset purchases", assetRows(annex.assetPurchases), totals.assetPurchases],
    ["Fixed asset receipts", assetRows(annex.assetReceipts), totals.assetReceipts],
  ];
  const preamble = `Closing notes for the financial year ${year.startDate} to ${year.endDate}. This file accompanies the accounts workbook and is not part of it.`;
  const rows = [
    [preamble, "", "", "", "", "", ""].map(text).join(","),
    HEADER.join(","),
    ...sections.flatMap(([section, items, sectionTotals]) => [...items, ...totalRows(sectionTotals)].map((row) => line(section, row))),
  ];
  return `\uFEFF${rows.map((row) => `${row}\r\n`).join("")}`;
}
