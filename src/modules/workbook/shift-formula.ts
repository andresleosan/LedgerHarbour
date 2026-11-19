// A shared-formula clone stores no text: it is its master's formula with every relative
// reference moved by the distance between the two cells. Absolute parts (`$`) stay; text
// inside string literals, sheet names, function and defined names stay; a reference that
// would leave the sheet becomes #REF!, as in Excel.

const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;
const WORD = /[\p{L}\p{N}_.$\\?]+/uy;
const ERROR = /#[A-Za-z0-9_/]+[!?]?/y;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^(\$?)(\d+)$/;
/** After a word: a sheet name, a function name or a table name, never a reference. */
const NAME_END = new Set(["!", "(", "["]);

export function shiftFormula(formula: string, rows: number, columns: number): string {
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"' || ch === "'") {
      const end = closingQuote(formula, i);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "[") {
      const end = closingBracket(formula, i);
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    const sticky = ch === "#" ? ERROR : WORD;
    sticky.lastIndex = i;
    const word = sticky.exec(formula)?.[0];
    if (!word) {
      out += ch;
      i++;
      continue;
    }
    let end = i + word.length;
    const isName = ch === "#" || NAME_END.has(formula[end]);
    let shifted = isName ? word : undefined;
    if (shifted === undefined && formula[end] === ":") {
      WORD.lastIndex = end + 1;
      const second = WORD.exec(formula)?.[0];
      const range = second && !NAME_END.has(formula[end + 1 + second.length]) ? shiftRange(word, second, rows, columns) : undefined;
      if (range !== undefined) {
        shifted = range;
        end += 1 + second!.length;
      }
    }
    out += shifted ?? shiftCell(word, rows, columns) ?? word;
    i = end;
  }
  return out;
}

/** The shifted cell, "#REF!" if it leaves the sheet, undefined if `word` is not a cell reference. */
function shiftCell(word: string, rows: number, columns: number): string | undefined {
  const match = CELL.exec(word);
  if (!match) return undefined;
  const column = moveColumn(match[1], match[2], columns);
  const row = moveRow(match[3], match[4], rows);
  if (column === undefined || row === undefined) return undefined;
  return column === null || row === null ? "#REF!" : column + row;
}

function shiftRange(first: string, second: string, rows: number, columns: number): string | undefined {
  const cells = [first, second].map((word) => shiftCell(word, rows, columns));
  if (cells.every((cell) => cell !== undefined)) return cells.includes("#REF!") ? "#REF!" : cells.join(":");
  const parsed = [first, second].map((word) => COLUMN.exec(word) ?? ROW.exec(word));
  if (!parsed[0] || !parsed[1]) return undefined;
  const byColumn = COLUMN.test(first);
  if (byColumn !== COLUMN.test(second)) return undefined;
  const moved = parsed.map((p) => (byColumn ? moveColumn(p![1], p![2], columns) : moveRow(p![1], p![2], rows)));
  if (moved.includes(undefined)) return undefined;
  return moved.includes(null) ? "#REF!" : moved.join(":");
}

/** `$` + letters moved (null when it leaves the sheet, undefined when it is not a column). */
function moveColumn(dollar: string, letters: string, by: number): string | null | undefined {
  const index = [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  if (index > MAX_COLUMNS) return undefined;
  const moved = dollar ? index : index + by;
  if (moved < 1 || moved > MAX_COLUMNS) return null;
  let out = "";
  for (let n = moved; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return dollar + out;
}

function moveRow(dollar: string, digits: string, by: number): string | null | undefined {
  const index = Number(digits);
  if (index < 1 || index > MAX_ROWS) return undefined;
  const moved = dollar ? index : index + by;
  return moved < 1 || moved > MAX_ROWS ? null : dollar + moved;
}

/** Index just past the quote closing the one at `start`; a doubled quote is an escaped one. */
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let j = start + 1; j < text.length; j++) {
    if (text[j] !== quote) continue;
    if (text[j + 1] !== quote) return j + 1;
    j++;
  }
  return text.length;
}

function closingBracket(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) return j + 1;
  }
  return text.length;
}
