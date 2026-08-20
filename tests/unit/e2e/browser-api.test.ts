import { describe, expect, it } from "vitest";

import { resolveBrowserApiTarget } from "../../../tests/e2e/helpers/browser-api";

describe("browser API target resolution", () => {
  it("resolves relative requests against the page origin", () => {
    expect(resolveBrowserApiTarget("https://app.example.test/business/1", "/api/items")).toEqual({
      requestUrl: "https://app.example.test/api/items",
      cookieUrl: "https://app.example.test/api/items",
    });
  });

  it("rejects cross-origin absolute URLs without including the URL", () => {
    const action = () => resolveBrowserApiTarget(
      "https://app.example.test/business/1",
      "https://untrusted.example.test/private-value",
    );

    expect(action).toThrow("Cross-origin browser API requests are not allowed.");
    expect(action).not.toThrow(/untrusted|private-value/);
  });

  it("uses an HTTPS cookie scope for the same HTTP loopback origin", () => {
    expect(resolveBrowserApiTarget("http://127.0.0.1:3100/login", "/api/items")).toEqual({
      requestUrl: "http://127.0.0.1:3100/api/items",
      cookieUrl: "https://127.0.0.1:3100/api/items",
    });
  });
});
