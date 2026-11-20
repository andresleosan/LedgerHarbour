/**
 * Pure, strict reader of a bank statement CSV. It never guesses: an amount, a date or a
 * column it cannot read for certain is reported, never repaired.
 */
export const STATEMENT_MAX_BYTES = 1024 * 1024;
export const STATEMENT_MAX_LINES = 5_000;
export const DATE_FORMATS = ["day_first", "month_first"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Column indexes in the header. `reference` is appended to the description when it differs. */
export type StatementMapping = { date: number; description: number; reference?: number } & ({ amount: number } | { moneyIn: number; moneyOut: number });

export const STATEMENT_CSV_ERROR_CODES = {
  TOO_LARGE: "TOO_LARGE",
  EMPTY_STATEMENT: "EMPTY_STATEMENT",
  MALFORMED_CSV: "MALFORMED_CSV",
  INVALID_MAPPING: "INVALID_MAPPING",
} as const;
export type StatementCsvErrorCode = (typeof STATEMENT_CSV_ERROR_CODES)[keyof typeof STATEMENT_CSV_ERROR_CODES];

export class StatementCsvError extends Error {
  readonly name = "StatementCsvError";

  constructor(readonly code: StatementCsvErrorCode, readonly line?: number) {
    super(`The statement file could not be read (${code}).`);
  }
}

export type StatementLineReason = "INVALID_DATE" | "INVALID_AMOUNT" | "MISSING_AMOUNT" | "BOTH_AMOUNTS" | "MISSING_COLUMNS";

export interface StatementRow {
  line: number;
  date: string;
  description: string;
  /** Seen from the account: positive = money in. Never zero. */
  amountPence: number;
}

export interface ParsedStatement {
  headers: string[];
  mapping: StatementMapping | null;
  /** The format applied to numeric dates; null when the file has none or the choice is still needed. */
  dateFormat: DateFormat | null;
  needsDateFormat: boolean;
  rows: StatementRow[];
  skipped: { zero: number; notSterling: number; notCompleted: number };
  errors: Array<{ line: number; reason: StatementLineReason }>;
}

const DATE_NAMES = ["date", "transaction date", "completed date", "posting date", "posted date", "booking date", "value date"];
const DESCRIPTION_NAMES = ["description", "transaction description", "narrative", "details", "transaction details", "payee", "name", "memo", "reference"];
const AMOUNT_NAMES = ["amount", "value", "transaction amount", "amount (gbp)", "amount (£)"];
const PAIR_NAMES: Array<[string, string]> = [["paid in", "paid out"], ["money in", "money out"], ["credit", "debit"], ["credit amount", "debit amount"], ["in", "out"]];
const CURRENCY_NAMES = ["currency", "ccy"];
const STATUS_NAMES = ["state", "status"];
const NOT_COMPLETED = /pending|declined|reverted|failed/i;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_DATE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/;
const NAMED_DATE = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Optional sign before or after "£" (not both), UK thousands grouping, 0–2 decimals, at most 12 integer digits.
const MAX_VALUE_CELL = 64;
const AMOUNT = /^([+-]?)£?([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

const normalise = (header: string) => header.trim().toLowerCase().replace(/\s+/g, " ");

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** RFC 4180 records with the physical line each starts on; fully blank lines are dropped. */
function tokenize(text: string): Array<{ line: number; fields: string[] }> {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  const unquoted = firstLine.replace(/"[^"]*"/g, "");
  const delimiter = (unquoted.match(/;/g)?.length ?? 0) > (unquoted.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: Array<{ line: number; fields: string[] }> = [];
  let line = 1;
  let start = 1;
  let fields: string[] = [];
  let field = "";
  let index = 0;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0].trim() !== "") {
      records.push({ line: start, fields });
      if (records.length > STATEMENT_MAX_LINES + 1) throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.TOO_LARGE);
    }
    fields = [];
    field = "";
  };
  while (index < text.length) {
    const char = text[index];
    if (char === "\"" && field === "") {
      // Quoted field: runs to the closing quote; "" is a literal quote.
      let end = index + 1;
      let value = "";
      for (;;) {
        const quote = text.indexOf("\"", end);
        if (quote === -1) throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.MALFORMED_CSV, start);
        value += text.slice(end, quote);
        if (text[quote + 1] === "\"") { value += "\""; end = quote + 2; continue; }
        end = quote + 1;
        break;
      }
      line += value.match(/\r\n|\r|\n/g)?.length ?? 0;
      const next = text[end];
      if (next !== undefined && next !== delimiter && next !== "\r" && next !== "\n") throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.MALFORMED_CSV, start);
      field = value;
      index = next === delimiter ? end + 1 : end;
      if (next === delimiter) { fields.push(field); field = ""; }
      continue;
    }
    if (char === delimiter) { fields.push(field); field = ""; index++; continue; }
    if (char === "\r" || char === "\n") {
      endRecord();
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      line++;
      start = line;
      continue;
    }
    field += char;
    index++;
  }
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}

function detectMapping(headers: string[]): StatementMapping | null {
  const names = headers.map(normalise);
  const find = (candidates: string[]) => {
    for (const candidate of candidates) {
      const found = names.indexOf(candidate);
      if (found !== -1) return found;
    }
    return -1;
  };
  const date = find(DATE_NAMES);
  const description = find(DESCRIPTION_NAMES);
  if (date === -1 || description === -1) return null;
  const referenceAt = names.indexOf("reference");
  const reference = referenceAt !== -1 && referenceAt !== description ? { reference: referenceAt } : {};
  const amount = find(AMOUNT_NAMES);
  if (amount !== -1) return { date, description, ...reference, amount };
  for (const [moneyIn, moneyOut] of PAIR_NAMES) {
    const inAt = names.indexOf(moneyIn);
    const outAt = names.indexOf(moneyOut);
    if (inAt !== -1 && outAt !== -1) return { date, description, ...reference, moneyIn: inAt, moneyOut: outAt };
  }
  return null;
}

function validateMapping(mapping: StatementMapping, columns: number): StatementMapping {
  const values = "amount" in mapping
    ? [mapping.date, mapping.description, mapping.amount]
    : [mapping.date, mapping.description, mapping.moneyIn, mapping.moneyOut];
  if (mapping.reference !== undefined) values.push(mapping.reference);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value >= columns) || new Set(values).size !== values.length) {
    throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.INVALID_MAPPING);
  }
  return mapping;
}

function calendar(year: number, month: number, day: number): string | null {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type ReadDate = { iso: string | null } | { dayFirst: string | null; monthFirst: string | null };

function readDate(text: string): ReadDate {
  if (text.length > MAX_VALUE_CELL) return { iso: null };
  const iso = ISO_DATE.exec(text);
  if (iso) return { iso: calendar(Number(iso[1]), Number(iso[2]), Number(iso[3])) };
  const numeric = NUMERIC_DATE.exec(text);
  if (numeric) {
    const [first, second, year] = [Number(numeric[1]), Number(numeric[3]), Number(numeric[4])];
    return { dayFirst: calendar(year, second, first), monthFirst: calendar(year, first, second) };
  }
  const named = NAMED_DATE.exec(text);
  if (named) {
    const name = named[2].toLowerCase();
    const month = name.length === 3 ? MONTHS.indexOf(name) : name === "sept" ? 8 : FULL_MONTHS.indexOf(name);
    return { iso: month === -1 ? null : calendar(Number(named[3]), month + 1, Number(named[1])) };
  }
  return { iso: null };
}

/** Signed pence, or null when the text is not an amount this reader accepts. */
function readAmount(text: string): number | null {
  // No real amount is this long; refusing first keeps every check below linear in a hostile cell.
  if (text.length > MAX_VALUE_CELL) return null;
  let value = text;
  let sign = 1;
  let marked = false;
  const suffix = value.slice(-2).toUpperCase();
  if (suffix === "CR" || suffix === "DR") { value = value.slice(0, -2).trimEnd(); sign = suffix === "DR" ? -1 : 1; marked = true; }
  if (value.startsWith("(") && value.endsWith(")")) {
    if (marked) return null;
    value = value.slice(1, -1);
    sign = -1;
    marked = true;
  }
  const match = AMOUNT.exec(value);
  if (!match) return null;
  const [, before, after, integer, fraction = ""] = match;
  if ((before && after) || (marked && (before || after))) return null;
  const digits = integer.replace(/,/g, "");
  if (digits.length > 12) return null;
  const pence = Number(digits) * 100 + Number(fraction.padEnd(2, "0"));
  if (pence === 0) return 0;
  return (before || after) === "-" ? -pence : sign * pence;
}

type Candidate = { line: number; date: ReadDate; description: string; amountPence: number };

export function parseStatementCsv(text: string, options: { mapping?: StatementMapping; dateFormat?: DateFormat } = {}): ParsedStatement {
  if (typeof text !== "string") throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.EMPTY_STATEMENT);
  if (text.length > STATEMENT_MAX_BYTES || utf8Bytes(text) > STATEMENT_MAX_BYTES) throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.TOO_LARGE);
  const records = tokenize(text.startsWith("﻿") ? text.slice(1) : text);
  if (records.length === 0) throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.EMPTY_STATEMENT);
  const [header, ...data] = records;
  if (data.length > STATEMENT_MAX_LINES) throw new StatementCsvError(STATEMENT_CSV_ERROR_CODES.TOO_LARGE);
  const headers = header.fields.map((name) => name.trim());
  const mapping = options.mapping ? validateMapping(options.mapping, headers.length) : detectMapping(headers);
  const skipped = { zero: 0, notSterling: 0, notCompleted: 0 };
  const errors: ParsedStatement["errors"] = [];
  const result = (rows: StatementRow[], dateFormat: DateFormat | null, needsDateFormat: boolean): ParsedStatement => ({ headers, mapping, dateFormat, needsDateFormat, rows, skipped, errors });
  if (!mapping) return result([], null, false);

  const names = headers.map(normalise);
  const currency = names.findIndex((name) => CURRENCY_NAMES.includes(name));
  const status = names.findIndex((name) => STATUS_NAMES.includes(name));
  const needed = Math.max(...Object.values(mapping));
  const candidates: Candidate[] = [];
  for (const { line, fields } of data) {
    if (fields.length <= needed) { errors.push({ line, reason: "MISSING_COLUMNS" }); continue; }
    const cell = (column: number) => (fields[column] ?? "").trim();
    if (status !== -1 && NOT_COMPLETED.test(cell(status))) { skipped.notCompleted++; continue; }
    if (currency !== -1 && cell(currency) !== "" && cell(currency).toUpperCase() !== "GBP") { skipped.notSterling++; continue; }

    let amountPence: number | null;
    if ("amount" in mapping) {
      if (cell(mapping.amount) === "") { errors.push({ line, reason: "MISSING_AMOUNT" }); continue; }
      amountPence = readAmount(cell(mapping.amount));
    } else {
      const moneyIn = cell(mapping.moneyIn) === "" ? 0 : readAmount(cell(mapping.moneyIn));
      const moneyOut = cell(mapping.moneyOut) === "" ? 0 : readAmount(cell(mapping.moneyOut));
      if (moneyIn === null || moneyOut === null || moneyIn < 0) { errors.push({ line, reason: "INVALID_AMOUNT" }); continue; }
      if (moneyIn !== 0 && moneyOut !== 0) { errors.push({ line, reason: "BOTH_AMOUNTS" }); continue; }
      amountPence = moneyIn !== 0 ? moneyIn : -Math.abs(moneyOut);
    }
    if (amountPence === null) { errors.push({ line, reason: "INVALID_AMOUNT" }); continue; }
    if (amountPence === 0) { skipped.zero++; continue; }

    const main = cell(mapping.description);
    const reference = mapping.reference === undefined ? "" : cell(mapping.reference);
    const description = reference && reference.toLowerCase() !== main.toLowerCase() ? [main, reference].filter(Boolean).join(" ") : main;
    candidates.push({ line, date: readDate(cell(mapping.date)), description, amountPence });
  }

  const numeric = candidates.filter((candidate) => !("iso" in candidate.date));
  const onlyMonthFirst = numeric.some(({ date }) => "dayFirst" in date && date.dayFirst === null && date.monthFirst !== null);
  if (!options.dateFormat && onlyMonthFirst) return result([], null, true);
  const dateFormat = options.dateFormat ?? (numeric.length > 0 ? "day_first" : null);
  const rows: StatementRow[] = [];
  for (const candidate of candidates) {
    const date = "iso" in candidate.date ? candidate.date.iso : dateFormat === "month_first" ? candidate.date.monthFirst : candidate.date.dayFirst;
    if (date === null) errors.push({ line: candidate.line, reason: "INVALID_DATE" });
    else rows.push({ line: candidate.line, date, description: candidate.description, amountPence: candidate.amountPence });
  }
  errors.sort((left, right) => left.line - right.line);
  return result(rows, dateFormat, false);
}
