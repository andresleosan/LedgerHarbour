import type { Page } from "@playwright/test";

const MAX_MESSAGE_LENGTH = 500;
const MAX_DIAGNOSTIC_EVENTS = 20;
const REDACTED_MESSAGE = "[REDACTED SENSITIVE DIAGNOSTIC]";
const REDACTED_PATH = "/[sensitive-path]";
const SENSITIVE_INDICATOR = /password|token|secret|cookie|authorization|api[-_]?key|credential/i;
const attachedPages = new WeakSet<object>();

export interface BrowserDiagnostic {
  kind: "console.error" | "pageerror";
  url: string;
  message: string;
}

export interface BrowserDiagnostics {
  recordConsoleError(url: string, message: string): void;
  recordPageError(url: string, message: string): void;
  assertClean(): void;
}

function safeMessage(value: string): string {
  if (SENSITIVE_INDICATOR.test(value)) return REDACTED_MESSAGE;
  return value.length > MAX_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_MESSAGE_LENGTH)} [truncated]`
    : value;
}

function safePath(value: string): string {
  try {
    const pathname = new URL(value).pathname || "/";
    return SENSITIVE_INDICATOR.test(pathname) ? REDACTED_PATH : pathname;
  } catch {
    return "/[invalid-url]";
  }
}

export function createBrowserDiagnostics(): BrowserDiagnostics {
  const errors: BrowserDiagnostic[] = [];
  let totalErrors = 0;
  const record = (kind: BrowserDiagnostic["kind"], url: string, message: string) => {
    totalErrors += 1;
    if (errors.length < MAX_DIAGNOSTIC_EVENTS) {
      errors.push({ kind, url: safePath(url), message: safeMessage(message) });
    }
  };

  return {
    recordConsoleError: (url, message) => record("console.error", url, message),
    recordPageError: (url, message) => record("pageerror", url, message),
    assertClean() {
      if (totalErrors === 0) return;
      const omitted = totalErrors - errors.length;
      const lines = errors.map((error) => `- ${error.kind} ${error.url}: ${error.message}`);
      if (omitted > 0) lines.push(`- ${omitted} additional browser diagnostics omitted`);
      throw new Error(
        `Browser diagnostics detected:\n${lines.join("\n")}`,
      );
    },
  };
}

export function attachPageDiagnostics(
  page: Pick<Page, "on" | "url">,
  diagnostics: BrowserDiagnostics,
): void {
  if (attachedPages.has(page)) return;
  attachedPages.add(page);
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.recordConsoleError(page.url(), message.text());
  });
  page.on("pageerror", (error) => diagnostics.recordPageError(page.url(), error.message));
}
