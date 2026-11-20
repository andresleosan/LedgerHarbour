import type { Page } from "@playwright/test";

import { browserApiRequest } from "../helpers/browser-api";

export interface RelayedResponse {
  path: string;
  status: number;
}

type RelayBody =
  | { kind: "file"; name: string; type: string; base64: string }
  | { kind: "json"; text: string }
  | null;

/**
 * Chromium logs every 4xx/5xx fetch as a console error, which the fixtures' gate rejects. The page's
 * POSTs whose path matches `pathPattern` are sent to the real server by Playwright's request client
 * instead, and the server's real status and body are handed back to the page's own code. Every other
 * request, and every console error, still goes through the gate. Returns the relayed responses.
 */
export async function relayFetches(page: Page, pathPattern: RegExp): Promise<RelayedResponse[]> {
  const relayed: RelayedResponse[] = [];
  await page.exposeFunction("__lhRelayFetch", async (url: string, body: RelayBody) => {
    const response = body?.kind === "file"
      ? await browserApiRequest(page, url, {
        method: "POST",
        multipart: { file: { name: body.name, mimeType: body.type, buffer: Buffer.from(body.base64, "base64") } },
      })
      : await browserApiRequest(page, url, { method: "POST", data: body ? JSON.parse(body.text) : {} });
    relayed.push({ path: new URL(url).pathname, status: response.status });
    return { status: response.status, body: response.body, contentType: response.headers["content-type"] ?? "application/json" };
  });
  await page.addInitScript((source) => {
    const pattern = new RegExp(source);
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(), location.href);
      if ((init?.method ?? "GET").toUpperCase() !== "POST" || !pattern.test(url.pathname)) return originalFetch(input, init);
      let body: RelayBody = null;
      const file = init?.body instanceof FormData ? init.body.get("file") : null;
      if (file instanceof File) {
        let binary = "";
        for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
        body = { kind: "file", name: file.name, type: file.type, base64: btoa(binary) };
      } else if (typeof init?.body === "string") {
        body = { kind: "json", text: init.body };
      }
      const response = await (window as unknown as {
        __lhRelayFetch(url: string, body: RelayBody): Promise<{ status: number; body: string; contentType: string }>;
      }).__lhRelayFetch(url.toString(), body);
      return new Response(response.body, { status: response.status, headers: { "Content-Type": response.contentType } });
    };
  }, pathPattern.source);
  return relayed;
}
