import { describe, expect, it } from "vitest";

import { STATEMENT_CSV_ERROR_CODES, STATEMENT_MAX_BYTES, STATEMENT_MAX_LINES, parseStatementCsv } from "../../../src/modules/accounting/statement-csv";

// Synthetic statements only: invented payees and amounts.
const csv = (...lines: string[]) => lines.join("\n");
const pence = (text: string) => parseStatementCsv(csv("Date,Description,Amount", `2026-05-01,Line,"${text}"`));
const one = (text: string) => {
  const parsed = pence(text);
  return parsed.errors.length ? parsed.errors[0].reason : parsed.rows[0]?.amountPence ?? "skipped";
};

describe("statement CSV: shape", () => {
  it("reads comma and semicolon delimiters, quotes, a BOM and CRLF", () => {
    const comma = parseStatementCsv("﻿Date,Description,Amount\r\n2026-05-01,\"Smith, \"\"J\"\" & Co\",-12.50\r\n2026-05-02,\"Two\nlines\",3\r\n");
    expect(comma.headers).toEqual(["Date", "Description", "Amount"]);
    expect(comma.rows).toEqual([
      { line: 2, date: "2026-05-01", description: "Smith, \"J\" & Co", amountPence: -1250 },
      { line: 3, date: "2026-05-02", description: "Two\nlines", amountPence: 300 },
    ]);
    const semicolon = parseStatementCsv(csv("Date;Description;Amount", "01/05/2026;\"A;B\";1,234.56"));
    expect(semicolon.rows).toEqual([{ line: 2, date: "2026-05-01", description: "A;B", amountPence: 123456 }]);
  });

  it("numbers lines as in the file, skipping blank lines, and counts a quoted line break", () => {
    const parsed = parseStatementCsv(csv("Date,Description,Amount", "", "2026-05-01,\"a\nb\",1", "", "2026-05-02,c,bad"));
    expect(parsed.rows.map((row) => row.line)).toEqual([3]);
    expect(parsed.errors).toEqual([{ line: 6, reason: "INVALID_AMOUNT" }]);
  });

  it("refuses broken quoting, an empty file and an unknown delimiter-less file is just unmapped", () => {
    expect(() => parseStatementCsv(csv("Date,Description,Amount", "2026-05-01,\"open,1"))).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.MALFORMED_CSV }));
    expect(() => parseStatementCsv(csv("Date,Description,Amount", "2026-05-01,\"a\"b,1"))).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.MALFORMED_CSV }));
    expect(() => parseStatementCsv("﻿\n\n")).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.EMPTY_STATEMENT }));
    expect(parseStatementCsv(csv("Something", "x"))).toMatchObject({ headers: ["Something"], mapping: null, rows: [], errors: [] });
  });

  it("keeps a stray quote inside an unquoted field as text", () => {
    expect(parseStatementCsv(csv("Date,Description,Amount", "2026-05-01,O\"Brien,1")).rows[0].description).toBe("O\"Brien");
  });

  it("caps the size and the number of lines", () => {
    const header = "Date,Description,Amount\n";
    expect(() => parseStatementCsv(header + "x".repeat(STATEMENT_MAX_BYTES))).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.TOO_LARGE }));
    // Multi-byte text counts in bytes, not characters.
    expect(() => parseStatementCsv(header + "£".repeat(STATEMENT_MAX_BYTES / 2))).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.TOO_LARGE }));
    const lines = (count: number) => header + Array.from({ length: count }, () => "2026-05-01,a,1").join("\n");
    expect(parseStatementCsv(lines(STATEMENT_MAX_LINES)).rows).toHaveLength(STATEMENT_MAX_LINES);
    expect(() => parseStatementCsv(lines(STATEMENT_MAX_LINES + 1))).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.TOO_LARGE }));
  });

  it("survives hostile input: a very long field, 5,000 columns and formula-looking text", () => {
    const long = "y".repeat(500_000);
    expect(parseStatementCsv(csv("Date,Description,Amount", `2026-05-01,${long},1`)).rows[0].description).toHaveLength(500_000);
    const wide = Array.from({ length: 5_000 }, (_, index) => `c${index}`);
    wide[4_997] = "Date"; wide[4_998] = "Description"; wide[4_999] = "Amount";
    const values = Array.from({ length: 5_000 }, () => "");
    values[4_997] = "2026-05-01"; values[4_998] = "Wide"; values[4_999] = "2";
    expect(parseStatementCsv(csv(wide.join(","), values.join(","))).rows).toEqual([{ line: 2, date: "2026-05-01", description: "Wide", amountPence: 200 }]);
    const formula = parseStatementCsv(csv("Date,Description,Amount", "2026-05-01,\"=HYPERLINK(\"\"http://x\"\")\",1", "2026-05-02,+cmd|' /C calc'!A0,2"));
    expect(formula.rows.map((row) => row.description)).toEqual(["=HYPERLINK(\"http://x\")", "+cmd|' /C calc'!A0"]);
  });
});

describe("statement CSV: columns", () => {
  it.each([
    ["Date", "Description", "Amount"],
    ["Transaction Date", "Narrative", "Value"],
    ["Completed Date", "Details", "Amount"],
    ["Posting Date", "Memo", "Transaction Amount"],
    ["DATE", "PAYEE", "AMOUNT"],
  ])("finds %s / %s / %s", (date, description, amount) => {
    const parsed = parseStatementCsv(csv(`Other,${date},${description},${amount}`, "x,2026-05-01,Shop,-1.00"));
    expect(parsed.mapping).toEqual({ date: 1, description: 2, amount: 3 });
    expect(parsed.rows).toEqual([{ line: 2, date: "2026-05-01", description: "Shop", amountPence: -100 }]);
  });

  it.each([
    ["Paid in", "Paid out"],
    ["Money In", "Money Out"],
    ["Credit", "Debit"],
  ])("reads a %s / %s pair: in positive, out negative, exactly one filled", (moneyIn, moneyOut) => {
    const parsed = parseStatementCsv(csv(`Date,Description,${moneyOut},${moneyIn}`, "2026-05-01,Rent,45.00,", "2026-05-02,Sale,,120", "2026-05-03,Both,1,2", "2026-05-04,None,,", "2026-05-05,Signed out,-3.00,", "2026-05-06,Neg in,,-3"));
    expect(parsed.mapping).toEqual({ date: 0, description: 1, moneyIn: 3, moneyOut: 2 });
    expect(parsed.rows.map((row) => [row.description, row.amountPence])).toEqual([["Rent", -4500], ["Sale", 12000], ["Signed out", -300]]);
    expect(parsed.errors).toEqual([{ line: 4, reason: "BOTH_AMOUNTS" }, { line: 7, reason: "INVALID_AMOUNT" }]);
    expect(parsed.skipped.zero).toBe(1);
  });

  it("prefers a signed amount over a pair, and the description over the reference, appending the reference when different", () => {
    const parsed = parseStatementCsv(csv("Reference,Date,Money In,Money Out,Amount,Description", "INV-7,2026-05-01,,9,-9,Acme", "acme,2026-05-02,,9,-9,Acme", ",2026-05-03,,1,-1,", "REF-9,2026-05-04,,1,-1,"));
    expect(parsed.mapping).toEqual({ date: 1, description: 5, reference: 0, amount: 4 });
    expect(parsed.rows.map((row) => row.description)).toEqual(["Acme INV-7", "Acme", "", "REF-9"]);
  });

  it("uses an explicit mapping and refuses an impossible one", () => {
    const text = csv("When,What,How much", "2026-05-01,Thing,-2");
    expect(parseStatementCsv(text).mapping).toBeNull();
    expect(parseStatementCsv(text, { mapping: { date: 0, description: 1, amount: 2 } }).rows).toEqual([{ line: 2, date: "2026-05-01", description: "Thing", amountPence: -200 }]);
    for (const mapping of [{ date: 0, description: 1, amount: 3 }, { date: 0, description: 0, amount: 2 }, { date: -1, description: 1, amount: 2 }, { date: 0.5, description: 1, amount: 2 }]) {
      expect(() => parseStatementCsv(text, { mapping })).toThrow(expect.objectContaining({ code: STATEMENT_CSV_ERROR_CODES.INVALID_MAPPING }));
    }
  });

  it("reports a line with too few columns", () => {
    expect(parseStatementCsv(csv("Date,Description,Amount", "2026-05-01,Short")).errors).toEqual([{ line: 2, reason: "MISSING_COLUMNS" }]);
  });

  it("skips and counts non-sterling, pending and zero lines without converting them", () => {
    const parsed = parseStatementCsv(csv(
      "Date,Description,Amount,Currency,State",
      "2026-05-01,Euro,-10,EUR,COMPLETED",
      "2026-05-02,Pending,-10,GBP,PENDING",
      "2026-05-03,Declined,-10,GBP,declined",
      "2026-05-04,Reverted,-10,gbp,Reverted",
      "2026-05-05,Failed,-10,GBP,FAILED",
      "2026-05-06,Zero,0.00,GBP,COMPLETED",
      "2026-05-07,Kept,-10,gbp,Completed",
      "2026-05-08,Blank currency,-1,,",
    ));
    expect(parsed.skipped).toEqual({ zero: 1, notSterling: 1, notCompleted: 4 });
    expect(parsed.rows.map((row) => row.description)).toEqual(["Kept", "Blank currency"]);
  });
});

describe("statement CSV: dates", () => {
  const dates = (...values: string[]) => parseStatementCsv(csv("Date,Description,Amount", ...values.map((value) => `${value},x,1`)));

  it("reads ISO with or without a time, and day-first numeric and named dates", () => {
    const parsed = dates("2026-05-01", "2026-05-02 14:03:59", "2026-05-03T09:00:00Z", "04/05/2026", "05-05-2026", "06.05.2026", "7 May 2026", "08 Sep 2026", "9 September 2026");
    expect(parsed.rows.map((row) => row.date)).toEqual(["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07", "2026-09-08", "2026-09-09"]);
    expect(parsed).toMatchObject({ dateFormat: "day_first", needsDateFormat: false, errors: [] });
    expect(dates("2026-05-01").dateFormat).toBeNull();
  });

  it("never guesses month-first: a line only valid month-first makes the file ambiguous", () => {
    const ambiguous = dates("01/05/2026", "05/13/2026");
    expect(ambiguous).toMatchObject({ dateFormat: null, needsDateFormat: true, rows: [], errors: [] });
    const chosen = parseStatementCsv(csv("Date,Description,Amount", "01/05/2026,x,1", "05/13/2026,x,1"), { dateFormat: "month_first" });
    expect(chosen.rows.map((row) => row.date)).toEqual(["2026-01-05", "2026-05-13"]);
    expect(chosen.dateFormat).toBe("month_first");
  });

  it("reports impossible and unreadable dates as line errors", () => {
    expect(dates("31/02/2026", "2026-13-01", "32 Jan 2026", "1/5/26", "May 1 2026", "").errors.map((error) => [error.line, error.reason])).toEqual([
      [2, "INVALID_DATE"], [3, "INVALID_DATE"], [4, "INVALID_DATE"], [5, "INVALID_DATE"], [6, "INVALID_DATE"], [7, "INVALID_DATE"],
    ]);
  });
});

describe("statement CSV: amounts", () => {
  it.each([
    ["12.34", 1234], ["-12.34", -1234], ["+12.3", 1230], ["7", 700], ["£12.00", 1200], ["-£12.00", -1200], ["£-12.00", -1200],
    ["1,234.56", 123456], ["1,234,567", 123456700], ["(45.00)", -4500], ["(£45.00)", -4500], ["45.00 CR", 4500], ["45.00 DR", -4500], ["45.00dr", -4500],
    [" 1.00 ", 100],
  ])("reads %s as %i pence", (text, expected) => expect(one(text)).toBe(expected));

  it.each(["12.345", "1,23", "12,34", "1,2345.00", "12.", ".50", "--1", "+-1", "-(1)", "(1) CR", "-1 DR", "1e3", "£", "abc", "1 234", "EUR 5", "1234567890123"])("refuses %s", (text) => {
    expect(one(text)).toBe("INVALID_AMOUNT");
  });

  it("refuses an empty single amount", () => expect(one("")).toBe("MISSING_AMOUNT"));

  it("refuses an oversized amount cell without backtracking over it", () => {
    const started = Date.now();
    expect(one(`1${" ".repeat(200_000)}X`)).toBe("INVALID_AMOUNT");
    expect(one(`${"1".repeat(65)} CR`)).toBe("INVALID_AMOUNT");
    // A regression is quadratic: tens of seconds for this one cell.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("skips zero amounts", () => {
    expect(one("0")).toBe("skipped");
    expect(pence("-0.00").skipped.zero).toBe(1);
  });
});
