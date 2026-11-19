# LH-012: From the Invoice Photo to the Accountant's Workbook — Design

## Status

Design written by the `/avanzar` loop on 2026-11-19 from the operator's brief of
the same day. It was not reviewed by the operator or by the accountant before
implementation started. Every decision below names its source; the ones marked
**default** are the prudent option taken without an answer and are listed again
in [Open questions for the accountant](#open-questions-for-the-accountant-lh-028).
An answer there replaces the default and is recorded in this file.

Source keys used below:

- **Goal** — the goal in [`docs/roadmap/AVANZAR.md`](../../roadmap/AVANZAR.md).
- **Cards** — the task cards `docs/roadmap/tasks/LH-013..LH-026.json`.
- **Workbook** — the private starting analysis of the accountant's real workbook
  (formulas read cell by cell, not recalculated). It is not in this repository.
- **App** — the current code and the 2026-08-11 design specification.
- **Simplest** — the simplest reversible option that satisfies the card.

## Goal

A business owner photographs invoices on a phone. The app returns the
accountant's annual accounts workbook (an Excel template the accountant
supplies) filled in: every money movement on the sheet of its account, with
date, narrative, code and signed amount, without touching any formula. The app
also shows a summary of the financial year.

This supersedes, for this narrow purpose only, the "Full accounting ledger"
entry in the deferred scope of the 2026-08-11 design. The app still does not
become a ledger: it produces the *inputs* of the accountant's workbook and
leaves every calculation to the workbook.

## The central fact: the workbook is a bank analysis, not an invoice list

Source: **Workbook**.

The accountant's template has one sheet per money account (bank accounts and a
cash book). A person types one row per line of the bank statement. Each row has
a code, and the code must equal one of the headings in a single heading row.
Each heading owns an analysis column whose formula copies the amount when the
row's code equals the heading. Column totals feed a trial balance by position,
and the trial balance feeds the statements.

Consequences that shape everything below:

1. The unit of the workbook is **a movement of money through an account**, not
   an invoice. An invoice only becomes a row when, and on the date, it is paid
   from one of the business's accounts.
2. A photographed invoice supplies the narrative and a candidate amount. It does
   not supply which account paid, the payment date, whether it is paid at all,
   the sterling amount actually debited, or the code. The owner supplies those
   on the phone, in one step, when approving the invoice.
3. Money that moves without an invoice (sales receipts, owner drawings, bank
   charges, transfers) must also be rows, or the account balance is wrong.
4. Only the code and the amount drive numbers. The date and narrative are read
   by no formula: being on the sheet is what puts a row in the year.

## The row contract

Source: **Workbook** (cells and sign rule), **Cards** LH-015 and LH-024.

One exported row is exactly:

| Field | Type | Rule |
| --- | --- | --- |
| Money account | reference | Decides the sheet. One sheet per real account. |
| Date | calendar date | The date the money moved through the account, inside the financial year. Written as an Excel date serial. |
| Narrative | text, 1–200 chars | Free text. For an invoice: `supplier + " " + invoice number`. |
| Code | a heading of the business's chart | Written with the heading's exact value **and data type** as in the template. Never blank. |
| Amount | signed, pounds sterling, 2 decimals, never zero | Seen from the account: **positive = money in, negative = money out**. Written as a number, never as text. |

Examples: supplier payment, negative on an expense heading. Sale receipt,
positive on an income heading. Owner drawing, negative on the drawings heading.
Supplier refund or credit note, positive on the expense heading.

A statement line that covers several codes is several rows with the same date
and narrative whose amounts add up to the statement line.

The export writes only these four cells per row plus the opening balance cell of
each sheet. It never writes a formula cell, a heading, a total or anything on
another sheet.

## Chart of accounts: driven by the template

Source: **Workbook**, **Cards** LH-013 and LH-014.

The chart is not designed by the app. It is read from the business's template,
because the template decides what a code means.

A **heading** is:

| Field | Meaning |
| --- | --- |
| `id` | Stable internal identifier. Movements point at this, never at the label. |
| `position` | The heading's column in the template. This is its identity across re-imports. |
| `templateValue` | The exact cell value, byte for byte, including trailing spaces. |
| `valueType` | `text` or `number`. A numeric heading only matches a number cell. |
| `group` | `income`, `cost_of_sales`, `expenses`, `assets`, `liabilities` or `equity`. |
| `order` | Column order, used for lists and totals. |
| `displayName` | What the app shows. Defaults to the trimmed `templateValue`; editable. |
| `isActive` | Whether it is offered when coding. |
| `blockedReason` | Set when the template makes the heading unsafe (see below). A blocked heading cannot be chosen. |

Decisions:

- **Group comes from column position, not from wording.** The template assigns
  the statement section by the block a column sits in; the reader takes the
  group from the block labels above the heading row. A heading called
  "purchases" that sits in the overheads block is an overhead. The app shows the
  group next to every heading so the owner sees where the money will land.
  Source: **Workbook**.
- **Identity is the position.** Renaming a heading in the app changes
  `displayName` only. Re-importing a newer template matches headings by
  position, updates `templateValue`, `valueType` and `group`, and keeps every
  movement already coded. Source: **Cards** LH-014 ("rename without losing what
  is coded"), **Simplest**.
- **The export writes `templateValue`, never `displayName`,** and never edits the
  heading row. If the accountant wants different headings, the accountant
  supplies a new template and it is re-imported. Source: **Simplest**; whether
  the app may name placeholder headings in the file is the accountant's call
  (LH-028).
- **Blocked headings.** The reader blocks a heading, with a reason the owner can
  read, when: the heading cell is empty; the template marks it as not to be
  used; its column total is read by no trial-balance row or by more than one;
  or its analysis formula is missing on rows the business would use. Source:
  **Workbook** (each of these silently misstates the accounts).
- **Placeholders** (headings that are only a number or a letter) are imported
  inactive. They become usable when someone names and activates them; both
  steps are recorded in the audit trail. Renaming alone never activates. What account sits behind each one is
  the accountant's call (LH-028). Source: **Workbook**, **default**.
- The five seeded expense categories of the current app are not headings and are
  not migrated. Invoices stop using the category field once LH-020 lands.
  Source: **App** (a category has no code, group or order), **Simplest**.

## Money accounts

Source: **Cards** LH-015, **Workbook**.

A **money account** belongs to one business and has: a name, a kind (`bank` or
`cash`), the template sheet it is written to (one account per sheet, one sheet
per account), an opening balance for the financial year, and an active flag.

- All accounts are in pounds sterling. A bank account that holds other
  currencies cannot be represented by one sheet with one running balance and is
  out of scope. Source: **Workbook**, **App** (base currency is GBP).
- The opening balance is written to the sheet's opening cell so the running
  balance agrees with the bank statement. The template does not carry that
  figure into the statements: the accountant types opening balances separately
  in the trial balance. The control report says so. Source: **Workbook**.
- The template may hold a cash sheet that no formula reads. Cash movements are
  still written there, and the control report states that the accountant must
  journal that sheet's totals. Source: **Workbook**.

## Financial year

Source: **Cards** LH-015, **Workbook** (no formula reads the date), **default**.

- A financial year has a start date, an end date and a state: `open` or
  `closed`. One workbook is one financial year.
- Default for a new business: the calendar year. Editable while the year has no
  movements.
- A movement is rejected when its date is outside an open year. This is the
  app's only cut-off, because the workbook has none.
- Closing a year makes its movements read-only. Reopening is allowed to members
  with `edit_finance` and is written to the audit trail.
- At most one open year per business in the first version. **Simplest.**

## Movements

Source: **Cards** LH-015, LH-021, LH-022, LH-023.

A **movement** is the stored form of one row: business, financial year, money
account, date, narrative, heading, signed amount, origin and audit fields.

- `amount` is `numeric(14,2)`, signed, non-zero. All arithmetic is done in
  integer pence; no floating point touches money. Tests assert exact pence.
- `origin` is `invoice`, `manual` or `statement`, with the source reference
  (invoice id, or statement import id and line).
- `heading` may be empty **only** for `origin = statement` while the line waits
  in the "to code" tray. Every other path requires a heading.
- A movement created from an invoice is owned by the invoice: correcting or
  voiding the invoice corrects or removes its movements in the same
  transaction, so there are never duplicates.
- Create, edit and delete write an audit event. Deleting is a soft delete.
- Every table carries `business_id` with the same-tenant composite foreign keys
  the app already uses. Reading needs `read_finance`; writing needs
  `edit_finance`. Each task adds tests for both and for isolation between two
  businesses. Source: **App**.

### From an approved invoice to a movement (LH-020, LH-021)

At review the owner chooses the code from the list of active headings (grouped,
searchable), never by typing an identifier. The app proposes the last heading
used with the same supplier name. An invoice cannot be approved without a code.
An invoice may be split over several headings; the parts must add up to the
invoice total.

At approval the owner states how it was paid:

| Answer | What the app does |
| --- | --- |
| Paid from a business account | Asks the account, the payment date (default: the invoice date) and the amount debited in pounds (default: the invoice total when the invoice is in GBP; required entry otherwise). Creates the movement(s). |
| Not paid yet | No movement. The invoice is marked unpaid and appears in the year-end creditors list (LH-026). It can be marked paid later. |
| Paid with the owner's private money or with cash not in a cash account | No movement. Listed separately in the closing annex, because it is capital introduced and the accountant journals it. |

- An invoice creates a **negative** movement. A document marked as a credit note
  creates a **positive** one. The invoice gains a `kind` (`invoice` or
  `credit_note`), chosen at review, default `invoice`. Source: **Cards** LH-021,
  **Workbook**.
- A split invoice creates one movement per part. When the amount debited
  differs from the invoice total (foreign currency, bank fee), the parts are
  scaled in proportion and the pence left over by rounding go to the largest
  part, so the movements add up to the amount debited exactly. **Simplest.**
- The amount is the gross total. The tax amount read from the invoice is not
  split out: the template has no GST column or heading. Source: **Workbook**,
  **default** (the business is treated as not GST-registered until LH-028 says
  otherwise).
- The invoice's own currency and total are kept as read. No exchange rate is
  stored or computed: the sterling figure is what the bank debited, typed by the
  owner. Source: **App** (conversion deferred), **Workbook**.

### Movements without an invoice (LH-022)

A phone form for income, owner drawings, bank charges and transfers between the
business's own accounts, with the code chosen from the list.

A transfer creates two movements, equal and opposite, one on each account, with
the **same** heading on both so the heading nets to zero. The business sets
which heading is used for transfers once, before the first transfer; the app
does not guess it. A transfer between a bank account and a cash account whose
sheet is not consolidated does not net to zero in the template: the control
report flags it. Source: **Workbook**; the choice of heading is the
accountant's call (LH-028).

### Bank statement import (LH-023)

A CSV from the bank becomes one movement per line on that account,
`origin = statement`. A line is matched to an existing movement of the same
account with the same amount and a date within five days, and is not added
again; a line already imported (same account, date, amount and bank narrative
in a previous import) is skipped. Lines with no code wait in the "to code"
tray. Source: **Cards** LH-023; the five-day window is a **default**.

## Reading the template (LH-013)

Source: **Workbook**, **Cards** LH-013.

The reader takes an `.xlsx` and returns a **template profile**. It finds the
layout by structure, not by hard-coded cell addresses, so the same code works on
the accountant's file and on the synthetic one:

- An **account sheet** is a sheet with a heading row whose data cells, in a
  contiguous range of columns, hold the formula "if this column's heading equals
  this row's code, then this row's amount, else zero".
- From that formula the reader derives the code column, the amount column, the
  heading row, the analysis range, the first and last data row and the totals
  row. The date, narrative and balance columns come from the header labels next
  to them; the opening cell is the balance cell directly above the first data
  row.
- Headings that are formulas pointing at another sheet's heading row are
  followed to the sheet that holds the typed value.

The profile holds, per account sheet: name, the columns above, first and last
data row, totals row, the **safe last row**, and whether the sheet's totals
reach the trial balance. It also holds the ordered headings with group and
value type, and a list of **defects**:

| Defect | Why it matters |
| --- | --- |
| `BLANK_HEADING` | A row with an empty code matches it: an uncoded amount is posted to that column and no check notices. |
| `TRAILING_SPACE` | The code must carry the same space or it matches nothing. Informational: the export writes the exact value. |
| `NUMERIC_HEADING` | The code must be written as a number. Informational, for the same reason. |
| `BROKEN_REFERENCE` | A formula points at something deleted; everything downstream shows an error whatever is entered. |
| `TRUNCATED_ANALYSIS_COLUMN` | The heading's formula stops before the last data row: a row coded there below that point reaches no account. |
| `STALE_CLOSING_BALANCE` | The closing-balance cell reads a fixed row instead of the last one. |
| `UNCONSOLIDATED_SHEET` | No formula reads the sheet's totals. |
| `HEADING_TOTAL_NOT_READ` / `HEADING_TOTAL_READ_TWICE` | A heading's total reaches no trial-balance row, or more than one. |

The **safe last row** of a sheet is the last row up to which every unblocked
heading has its formula. It is the sheet's real capacity.

The business's template file is that business's data. It is stored in private
object storage like any uploaded document, never in the repository, and only
members with `edit_finance` can replace it.

**Library.** The choice is made in LH-013 by a test, not here. Requirement: read
cell values, cell types, formulas as text and number formats. A dependency is
added only if `pnpm audit --audit-level high` is clean and the reason is written
on the card. Source: **Cards** LH-013, the profile.

## Exporting the filled workbook (LH-024)

Source: **Cards** LH-024, **Workbook**.

The export returns a copy of the business's template with the year's movements.

1. **Blocked, with the reason, when** the year has a movement with no code, a
   movement on a blocked heading, or an account with no sheet. A partial book
   would misstate the bank balance, so nothing is exported partially.
   **Simplest**, **Cards** LH-023 and LH-024.
2. Per account sheet: the opening balance in the opening cell, then one row per
   movement from the first data row, ordered by date and then by creation
   order, with no gaps.
3. Date as an Excel date serial, keeping the cell's existing number format;
   if the cell has none, `dd/mm/yyyy`. Narrative as text. Code with the
   heading's exact `templateValue` and `valueType`. Amount as a number with two
   decimals.
4. The file is flagged to recalculate fully when opened, because the values
   cached inside formula cells are stale after writing.
5. **Proof that nothing else changed**, as an automated test on the synthetic
   template: every part of the exported file other than the written sheets and
   the recalculation flag is byte-identical to the template; inside a written
   sheet, only the input cells of the written rows and the opening cell differ;
   every formula cell has the same formula text as before. The implementation
   is the simplest one that passes this test. If a general spreadsheet library
   cannot pass it, the export patches the cells directly inside the sheet's XML.
6. **Read-back.** The export re-reads its own output and recomputes, from the
   written cells alone, the total per code and per account. They must equal the
   app's totals to the penny or the export fails.

### Control report

Returned with the workbook as a separate document (and shown on screen). It is
never written into the template. It states, in plain words:

- Rows written per sheet against the sheet's safe capacity. If the movements do
  not fit in the safe rows, the export is blocked and the report says by how
  many rows.
- Every template defect found by the reader that affects the result, and what
  it means for this file (for example: "the statements will show errors until
  the accountant repairs the broken references").
- Sheets whose totals no formula reads, and transfers that touch them.
- That opening balances also have to be entered in the trial balance by the
  accountant.
- The read-back totals.

The app never repairs the template. Whether the accountant accepts a repaired
copy is a question for the accountant (LH-028). Source: **Simplest**,
**default**.

## Year summary in the app (LH-025)

Totals per heading (grouped) and per account, the balance of each account
(opening balance plus movements), the number of movements waiting for a code and
of invoices not paid. Computed by the same function the export's read-back
compares against, so both agree to the penny. Visible only with `read_finance`;
the general dashboard keeps showing no amounts. Source: **Cards** LH-025,
**App**.

## Closing annex for the accountant (LH-026)

A separate download next to the workbook; it does not touch the template:

- Invoices unpaid at the year end: supplier, date, amount.
- Invoices paid with private money: supplier, date, amount.
- Purchases coded to a heading of the `assets` group: narrative, date, cost.

These are the items the accountant handles by journal, in the fixed-asset
schedule and in the notes. Source: **Cards** LH-026, **Workbook**.

## The synthetic test template

Source: **Cards** LH-013, the privacy rule of the profile.

Tests never use the accountant's file. A generator in the test support code
builds an `.xlsx` with the same *mechanism* and none of the real content:

- Invented sheet names: two bank sheets (one of them carrying the consolidation
  row) and one cash sheet that no formula reads.
- A heading row with invented headings covering every case: plain text, a
  heading with a trailing space, numeric placeholders, one empty heading, one
  marked as not to be used. Block labels above it for the six groups.
- Analysis columns with the "if heading equals code then amount" formula on a
  small number of data rows (for example 40), a running-balance column, an
  opening cell, a totals row and a consolidation row.
- A minimal trial-balance sheet that reads each heading's consolidated total by
  position, with the sign flipped for debit-type groups, and one control cell.
- Options to produce the defects on demand: a truncated analysis column, a
  broken reference, a stale closing-balance cell, a heading total read twice.
- A data-validation list on the code column and at least one cell style, so the
  "nothing else changed" proof has something to protect.

All names, headings and amounts in it are invented in the generator. The real
file is used only by hand, on the operator's machine, to check that the reader
describes it correctly; nothing from it is copied into the repository, test
fixtures, snapshots or messages.

## Out of scope

Source: **Goal**, **Workbook**, **Simplest**.

The app does not produce, and the export does not write: journals, trial-balance
opening balances and comparatives, the fixed-asset schedule, depreciation,
stock, accruals, wages, the tax computation, the notes, entity and period
labels, or any repair of the template. It does not handle GST returns,
non-sterling accounts, exchange rates, line-item reading of invoices, or
automatic coding beyond "last heading used with this supplier". These remain
the accountant's work in the workbook.

## Task map

| Task | Builds |
| --- | --- |
| LH-013 | Template reader, template profile, synthetic template generator. |
| LH-014 | Headings per business, imported from the profile; migration. |
| LH-015 | Money accounts, financial year, movements; migration. |
| LH-020 | Coding the invoice at review, with splits. |
| LH-021 | Paid / unpaid / private at approval; invoice-owned movements. |
| LH-022 | Movements without an invoice; transfers. |
| LH-023 | Bank statement import and the "to code" tray. |
| LH-024 | Export, proof of no other change, read-back, control report. |
| LH-025 | Year summary. |
| LH-026 | Closing annex. |

New tables are additive, written as migrations and tested in PGlite; applying
them to a real database is LH-029 and needs the operator.

## Open questions for the accountant (LH-028)

None of these blocks building. Each has the default the app uses until answered.

| # | Question | Default until answered | Affects |
| --- | --- | --- | --- |
| 1 | Will you supply a repaired template, or must the app fill yours exactly as it is? | Fill it as it is; never repair; report defects. | LH-024 |
| 2 | Do invoices unpaid at the year end enter the accounts as creditors, or are the accounts on a cash basis? | Not written to the workbook; listed in the closing annex. | LH-021, LH-026 |
| 3 | Is the business registered for GST? | No: the gross amount is the cost, one row. | LH-021 |
| 4 | Which account sits behind each placeholder heading, and should any renamed heading sit in another block? | Placeholders stay inactive until named; the group shown is the template's. | LH-014, LH-020 |
| 5 | What are the opening balances of each account, and is this the first year of trading? | The owner types each account's opening balance; trial-balance openings stay with the accountant. | LH-015, LH-024 |
| 6 | Which heading should both legs of a transfer between own accounts carry? | The business must choose one before its first transfer. | LH-022 |
| 7 | Does the business take and spend cash before banking it, and does the owner pay business costs privately? | Cash sheet supported; private payments listed in the annex. | LH-021, LH-026 |
| 8 | What are the start and end dates of the financial year? | Calendar year. | LH-015 |

Answers are recorded here, under the question, with the date and who answered.
