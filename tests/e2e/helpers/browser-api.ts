import type { Page } from "@playwright/test";

export interface BrowserApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function browserApiRequest(
  page: Page,
  url: string,
  options: { method?: string; data?: unknown } = {},
): Promise<BrowserApiResponse> {
  return page.evaluate(async ({ url: requestUrl, method, data }) => {
    const response = await fetch(requestUrl, {
      method,
      headers: data === undefined ? undefined : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  }, { url, method: options.method ?? "GET", data: options.data });
}
