import { describe, expect, it } from "vitest";

import { annexCsv } from "../../../src/modules/accounting/annex-csv";
import type { YearAnnex } from "../../../src/modules/accounting/annex-service";
import type { InvoiceId } from "../../../src/modules/invoices/ocr-provider";

const year = { id: "year-1", startDate: "2026-04-06", endDate: "2027-04-05" };
const none = { count: 0, byCurrency: [] };

function emptyAnnex(): YearAnnex {
  return {
    year,
    unpaidInvoices: [],
    privatelyPaidInvoices: [],
    assetPurchases: [],
    assetReceipts: [],
    totals: { unpaidInvoices: none, privatelyPaidInvoices: none, assetPurchases: none, assetReceipts: none },
  };
}

const invoice = (fields: Partial<YearAnnex["unpaidInvoices"][number]>) => ({
  id: "invoice" as InvoiceId, supplier: "Supplier", invoiceNumber: "INV-1", invoiceDate: "2026-05-01", total: "10.00", currency: "GBP", kind: "invoice" as const, undated: false, ...fields,
});
const asset = (fields: Partial<YearAnnex["assetPurchases"][number]>) => ({
  movementId: "movement", date: "2026-06-01", narrative: "Laptop", amount: "900.00", headingName: "Equipment", accountName: "Main bank", ...fields,
});

/** Splits RFC 4180 text into rows of fields; enough for the assertions here. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field || row.length) throw new Error("Last row not terminated by CRLF");
  return rows;
}

describe("closing annex CSV", () => {
  it("starts with a BOM, ends every row with CRLF and states what the file is", () => {
    const csv = annexCsv(emptyAnnex());
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const rows = parse(csv.slice(1));
    expect(rows[0][0]).toContain("2026-04-06");
    expect(rows[0][0]).toContain("2027-04-05");
    expect(rows[0][0]).toMatch(/accompanies the accounts workbook and is not part of it/);
    expect(rows[1]).toEqual(["section", "date", "name", "reference", "detail", "amount", "currency"]);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });

  it("keeps every section of an empty annex with a zero total row", () => {
    const rows = parse(annexCsv(emptyAnnex()).slice(1)).slice(2);
    expect(rows).toEqual([
      ["Unpaid at year end", "", "Total", "", "0 items", "0.00", "GBP"],
      ["Paid with private money", "", "Total", "", "0 items", "0.00", "GBP"],
      ["Fixed asset purchases", "", "Total", "", "0 items", "0.00", "GBP"],
      ["Fixed asset receipts", "", "Total", "", "0 items", "0.00", "GBP"],
    ]);
  });

  it("writes the sections in order with one total row per currency", () => {
    const annex = emptyAnnex();
    annex.unpaidInvoices = [invoice({ supplier: "Alpha", total: "12.5", currency: "EUR" }), invoice({ supplier: "Beta", invoiceDate: null, undated: true, total: "3.00" })];
    annex.privatelyPaidInvoices = [invoice({ supplier: "Gamma", invoiceNumber: "G-7", total: "4.20" })];
    annex.assetPurchases = [asset({})];
    annex.assetReceipts = [asset({ narrative: "Van sold", amount: "2500.00", headingName: "Vehicles", accountName: "Deposit" })];
    annex.totals = {
      unpaidInvoices: { count: 2, byCurrency: [{ currency: "EUR", count: 1, amount: "12.50" }, { currency: "GBP", count: 1, amount: "3.00" }] },
      privatelyPaidInvoices: { count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "4.20" }] },
      assetPurchases: { count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "900.00" }] },
      assetReceipts: { count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "2500.00" }] },
    };
    expect(parse(annexCsv(annex).slice(1)).slice(2)).toEqual([
      ["Unpaid at year end", "2026-05-01", "Alpha", "INV-1", "", "12.50", "EUR"],
      ["Unpaid at year end", "", "Beta", "INV-1", "Undated", "3.00", "GBP"],
      ["Unpaid at year end", "", "Total", "", "1 item", "12.50", "EUR"],
      ["Unpaid at year end", "", "Total", "", "1 item", "3.00", "GBP"],
      ["Paid with private money", "2026-05-01", "Gamma", "G-7", "", "4.20", "GBP"],
      ["Paid with private money", "", "Total", "", "1 item", "4.20", "GBP"],
      ["Fixed asset purchases", "2026-06-01", "Laptop", "Main bank", "Equipment", "900.00", "GBP"],
      ["Fixed asset purchases", "", "Total", "", "1 item", "900.00", "GBP"],
      ["Fixed asset receipts", "2026-06-01", "Van sold", "Deposit", "Vehicles", "2500.00", "GBP"],
      ["Fixed asset receipts", "", "Total", "", "1 item", "2500.00", "GBP"],
    ]);
  });

  it("quotes commas, quotes and line breaks and keeps non-ASCII text", () => {
    const annex = emptyAnnex();
    annex.unpaidInvoices = [invoice({ supplier: 'Smith, "Jones" & Sons\nLtd', invoiceNumber: "Ñandú–Ünïcødé €", currency: "GBP" })];
    annex.assetPurchases = [asset({ narrative: "Line one\r\nline two", headingName: "Équipement" })];
    const csv = annexCsv(annex);
    expect(csv).toContain('"Smith, ""Jones"" & Sons\nLtd"');
    expect(csv).toContain('"Line one\r\nline two"');
    const rows = parse(csv.slice(1));
    expect(rows[2].slice(2, 4)).toEqual(['Smith, "Jones" & Sons\nLtd', "Ñandú–Ünïcødé €"]);
    expect(rows.find((r) => r[0] === "Fixed asset purchases")!.slice(2, 5)).toEqual(["Line one\r\nline two", "Main bank", "Équipement"]);
  });

  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises a formula-looking text cell %j", (hostile) => {
    const annex = emptyAnnex();
    annex.unpaidInvoices = [invoice({ supplier: hostile, invoiceNumber: hostile, currency: hostile })];
    annex.assetPurchases = [asset({ narrative: hostile, headingName: hostile, accountName: hostile })];
    const rows = parse(annexCsv(annex).slice(1));
    const [unpaid] = rows.filter((r) => r[0] === "Unpaid at year end");
    const [purchase] = rows.filter((r) => r[0] === "Fixed asset purchases");
    for (const cell of [unpaid[2], unpaid[3], unpaid[6], purchase[2], purchase[3], purchase[4]]) expect(cell).toBe(`'${hostile}`);
  });

  it("marks a credit note in the detail and writes its negative amount as a plain number", () => {
    const annex = emptyAnnex();
    annex.unpaidInvoices = [invoice({ supplier: "Refunder", total: "-12.30", kind: "credit_note" }), invoice({ supplier: "Undated refunder", invoiceDate: null, undated: true, total: "-1.00", kind: "credit_note" })];
    annex.totals.unpaidInvoices = { count: 2, byCurrency: [{ currency: "GBP", count: 2, amount: "-13.30" }] };
    const csv = annexCsv(annex);
    expect(csv).toContain("\r\nUnpaid at year end,2026-05-01,Refunder,INV-1,Credit note,-12.30,GBP\r\n");
    expect(csv).toContain("\r\nUnpaid at year end,,Undated refunder,INV-1,Credit note; Undated,-1.00,GBP\r\n");
    expect(csv).toContain("\r\nUnpaid at year end,,Total,,2 items,-13.30,GBP\r\n");
    expect(csv).not.toContain("'-");
  });

  it("never prefixes the amount column, even when negative", () => {
    const annex = emptyAnnex();
    annex.unpaidInvoices = [invoice({ total: "-5.00" })];
    annex.totals.unpaidInvoices = { count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "-5.00" }] };
    const rows = parse(annexCsv(annex).slice(1)).filter((r) => r[0] === "Unpaid at year end");
    expect(rows.map((r) => r[5])).toEqual(["-5.00", "-5.00"]);
  });
});
