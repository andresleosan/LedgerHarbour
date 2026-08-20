import { describe, expect, it } from "vitest";

import { createBrowserDiagnostics } from "../../../tests/e2e/fixtures/browser-diagnostics";

describe("browser diagnostics", () => {
  it("does not throw when no browser errors were recorded", () => {
    expect(() => createBrowserDiagnostics().assertClean()).not.toThrow();
  });

  it("throws for a console error with its safe path and message", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError("https://example.test/admin?token=secret", "render failed");

    expect(() => diagnostics.assertClean()).toThrow(/console\.error[\s\S]*\/admin[\s\S]*render failed/);
    expect(() => diagnostics.assertClean()).not.toThrow(/secret/);
  });

  it("throws for a page error", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordPageError("https://example.test/login", "uncaught failure");

    expect(() => diagnostics.assertClean()).toThrow(/pageerror[\s\S]*\/login[\s\S]*uncaught failure/);
  });

  it("replaces sensitive messages with a fixed marker", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError(
      "https://example.test/admin",
      "password=secret token=abc",
    );

    expect(() => diagnostics.assertClean()).toThrow(/\[REDACTED SENSITIVE DIAGNOSTIC\]/);
    expect(() => diagnostics.assertClean()).not.toThrow(/password=secret|token=abc/);
  });

  it("hides the entire pathname and message when they contain sensitive indicators", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError(
      "https://example.test/admin/token/path-token/apiKey/path-api-key",
      'Authorization: Bearer bearer-secret {"apiKey":"json-api-key","password":"json-password"} apiKey=plain-api-key',
    );

    expect(() => diagnostics.assertClean()).toThrow(/\/\[sensitive-path\]/);
    expect(() => diagnostics.assertClean()).toThrow(/\[REDACTED SENSITIVE DIAGNOSTIC\]/);
    expect(() => diagnostics.assertClean()).not.toThrow(/path-token|path-api-key|bearer-secret|json-api-key|json-password|plain-api-key/);
  });

  it.each([
    ['password="value with spaces"', ["value with spaces"]],
    ["Authorization: Basic basic-credential", ["basic-credential"]],
    ["Cookie: sid=session-value; refresh=refresh-value", ["session-value", "refresh-value"]],
    ['password={"value":"nested-value"}', ["nested-value"]],
    ["Authorization=Bearer equals-secret", ["equals-secret"]],
  ])("does not retain sensitive message content from %s", (message, secretValues) => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError("https://example.test/admin", message);

    expect(() => diagnostics.assertClean()).toThrow(/\[REDACTED SENSITIVE DIAGNOSTIC\]/);
    for (const value of secretValues) {
      expect(() => diagnostics.assertClean()).not.toThrow(new RegExp(value));
    }
  });

  it("hides a pathname containing a sensitive compound segment", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordPageError(
      "https://example.test/auth/reset-password/path-value",
      "reset failed",
    );

    expect(() => diagnostics.assertClean()).toThrow(/pageerror \/\[sensitive-path\]: reset failed/);
    expect(() => diagnostics.assertClean()).not.toThrow(/reset-password|path-value/);
  });

  it("truncates normal messages to 500 characters", () => {
    const diagnostics = createBrowserDiagnostics();
    diagnostics.recordConsoleError("https://example.test/admin", "x".repeat(600));

    expect(() => diagnostics.assertClean()).toThrow(/x{500} \[truncated\]/);
    expect(() => diagnostics.assertClean()).not.toThrow(/x{501}/);
  });

  it("caps retained events and reports a fixed omitted count", () => {
    const diagnostics = createBrowserDiagnostics();
    for (let index = 1; index <= 25; index += 1) {
      diagnostics.recordConsoleError("https://example.test/admin", `failure-${index}`);
    }

    expect(() => diagnostics.assertClean()).toThrow(/5 additional browser diagnostics omitted/);
    expect(() => diagnostics.assertClean()).toThrow(/failure-20/);
    expect(() => diagnostics.assertClean()).not.toThrow(/failure-21|failure-25/);
  });
});
