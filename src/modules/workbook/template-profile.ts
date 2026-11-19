export type HeadingGroup = "income" | "cost_of_sales" | "expenses" | "assets" | "liabilities" | "equity";

export type HeadingBlockedReason =
  | "blank_heading"
  | "marked_do_not_use"
  | "total_not_read"
  | "total_read_twice"
  | "truncated_formula";

export interface TemplateHeading {
  /** 1-based column index of the heading in the account sheets; its identity. */
  position: number;
  /** Exact cell value including trailing spaces; "" when blank; numbers as their canonical string. */
  templateValue: string;
  valueType: "text" | "number";
  group: HeadingGroup;
  /** 0-based order, left to right. */
  order: number;
  blockedReason: HeadingBlockedReason | null;
}

export interface AccountSheet {
  name: string;
  /** 1-based column indexes. */
  dateColumn: number;
  narrativeColumn: number;
  codeColumn: number;
  balanceColumn: number;
  amountColumn: number;
  headingRow: number;
  /** A1 address of the typed opening balance, directly above the first data row. */
  openingBalanceCell: string;
  firstDataRow: number;
  lastDataRow: number;
  totalsRow: number;
  /** Last row up to which every unblocked heading has its analysis formula on this sheet. */
  safeLastRow: number;
  /** Whether the sheet's totals reach the trial balance. */
  consolidated: boolean;
}

export type TemplateDefectCode =
  | "BLANK_HEADING"
  | "TRAILING_SPACE"
  | "NUMERIC_HEADING"
  | "BROKEN_REFERENCE"
  | "TRUNCATED_ANALYSIS_COLUMN"
  | "STALE_CLOSING_BALANCE"
  | "UNCONSOLIDATED_SHEET"
  | "HEADING_TOTAL_NOT_READ"
  | "HEADING_TOTAL_READ_TWICE";

export interface TemplateDefect {
  code: TemplateDefectCode;
  sheet?: string;
  position?: number;
  detail: Record<string, number>;
}

export interface TemplateProfile {
  headings: TemplateHeading[];
  sheets: AccountSheet[];
  defects: TemplateDefect[];
}

export const TEMPLATE_READ_ERROR_CODES = {
  NOT_A_WORKBOOK: "NOT_A_WORKBOOK",
  NO_ACCOUNT_SHEET: "NO_ACCOUNT_SHEET",
  UNRECOGNISED_LAYOUT: "UNRECOGNISED_LAYOUT",
} as const;

export type TemplateReadErrorCode = (typeof TEMPLATE_READ_ERROR_CODES)[keyof typeof TEMPLATE_READ_ERROR_CODES];

export class TemplateReadError extends Error {
  readonly name = "TemplateReadError";

  constructor(readonly code: TemplateReadErrorCode, readonly sheet?: string) {
    super(code);
  }
}
