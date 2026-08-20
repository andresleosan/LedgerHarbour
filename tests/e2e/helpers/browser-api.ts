import type { Page } from "@playwright/test";

export interface BrowserApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

type MultipartFields = Record<string, string | { name: string; mimeType: string; buffer: Buffer }>;

type BrowserApiRequestOptions =
  | { method?: string; data?: never; multipart?: never }
  | { method?: string; data: unknown; multipart?: never }
  | { method?: string; data?: never; multipart: MultipartFields };

export function resolveBrowserApiTarget(pageUrl: string, value: string): {
  requestUrl: string;
  cookieUrl: string;
} {
  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(value, page);
  } catch {
    throw new Error("Invalid browser API request URL.");
  }
  if (target.origin !== page.origin) {
    throw new Error("Cross-origin browser API requests are not allowed.");
  }
  const cookieTarget = new URL(target);
  if (target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname)) {
    cookieTarget.protocol = "https:";
  }
  return { requestUrl: target.toString(), cookieUrl: cookieTarget.toString() };
}

export async function browserApiRequest(
  page: Page,
  url: string,
  options: BrowserApiRequestOptions = {},
): Promise<BrowserApiResponse> {
  const { requestUrl, cookieUrl } = resolveBrowserApiTarget(page.url(), url);
  const cookies = await page.context().cookies(cookieUrl);
  const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const method = options.method ?? "GET";
  const headers = cookieHeader ? { Cookie: cookieHeader } : undefined;
  const response = options.multipart
    ? await page.request.fetch(requestUrl, { method, headers, multipart: options.multipart })
    : await page.request.fetch(requestUrl, {
      method,
      headers: options.data === undefined
        ? headers
        : { ...(headers ?? {}), "Content-Type": "application/json" },
      data: options.data === undefined ? undefined : JSON.stringify(options.data),
    });
  return {
    status: response.status(),
    headers: response.headers(),
    body: await response.text(),
  };
}
