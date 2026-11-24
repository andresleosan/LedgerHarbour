import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let locale: string | null = null;
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(locale ? { locale } : {}) }));

const { RouteError, RouteLoading } = await import("../../../src/ui/RouteStates");
const reset = () => {};

describe("route states", () => {
  it("announces loading in the page language", () => {
    locale = null;
    expect(renderToStaticMarkup(createElement(RouteLoading))).toMatch(/role="status"[^>]*>.*Loading…/);
    locale = "es";
    expect(renderToStaticMarkup(createElement(RouteLoading))).toContain("Cargando…");
  });

  it("shows an alert with a retry button in the page language", () => {
    locale = null;
    const english = renderToStaticMarkup(createElement(RouteError, { reset }));
    expect(english).toContain('role="alert"');
    expect(english).toContain(">Try again</button>");
    locale = "es";
    expect(renderToStaticMarkup(createElement(RouteError, { reset }))).toContain(">Reintentar</button>");
  });
});
