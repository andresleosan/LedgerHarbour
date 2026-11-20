/**
 * True for an error this codebase threw on purpose: a named `…Error` class with an UPPER_SNAKE
 * `code` (MoneyError, StatementImportError, InvoiceError, …). Recognised by shape, not
 * `instanceof`, so a copy of the class from another route bundle still counts. Driver errors are
 * not: PostgreSQL ones carry a five-character SQLSTATE code (e.g. "23505") and Drizzle wraps them
 * in a plain `Error`.
 */
export function isApplicationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return /^[A-Z]\w*Error$/.test(error.name) && typeof code === "string" && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(code);
}
