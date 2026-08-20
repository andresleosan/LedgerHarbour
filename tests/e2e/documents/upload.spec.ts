import { expect, test } from "../fixtures";
import { createApprovedBusiness } from "../helpers/business";
import { browserApiRequest } from "../helpers/browser-api";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Signed in as");
}

async function stubUploadResponse(page: import("@playwright/test").Page, status: number, code: string) {
  await page.evaluate(({ status, code }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (requestUrl.includes("/api/businesses/") && requestUrl.endsWith("/documents")) {
        return new Response(JSON.stringify({ error: { code } }), { status, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  }, { status, code });
}

const validPdf = {
  name: "invoice.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"),
};
const validProgressiveJpeg = {
  name: "invoice.jpeg",
  mimeType: "image/jpeg",
  buffer: Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABlFET/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAP/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
    "base64",
  ),
};

test("uploads a real invoice fixture, shows uploaded, downloads it, and blocks another business", async ({ browserWithDiagnostics: browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signIn(owner, "documents-owner@example.com");
  const businessId = await createApprovedBusiness(browser, owner, "E2E Document Harbour");
  await owner.goto(`/business/${businessId}/upload`);
  await owner.locator('input[type="file"]').setInputFiles(validPdf);
  await owner.getByRole("button", { name: "Upload document" }).click();
  await expect(owner.getByRole("status")).toContainText("uploaded");
  const downloadLink = owner.getByRole("link", { name: "Download invoice.pdf" });
  await expect(downloadLink).toBeVisible();
  const downloadHref = await downloadLink.getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const downloaded = await browserApiRequest(owner, downloadHref as string);
  expect(downloaded.status, downloaded.body).toBe(200);
  expect(downloaded.headers["content-disposition"]).toContain("invoice.pdf");
  expect(downloaded.body).toContain("%PDF-1.7");

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, "documents-other@example.com");
  const otherBusinessId = await createApprovedBusiness(browser, other, "E2E Other Document Harbour");
  const documentId = (await owner.getByRole("link", { name: "Download invoice.pdf" }).getAttribute("href"))?.match(/documents\/([^/]+)\/download/)?.[1];
  expect(documentId).toBeTruthy();
  const forbidden = await browserApiRequest(other, `/api/documents/${documentId}/download`);
  expect(forbidden.status).toBe(403);
  expect(otherBusinessId).not.toBe(businessId);

  await ownerContext.close();
  await otherContext.close();
});

test("shows invalid and oversized validation errors, including Spanish copy", async ({ page, browserWithDiagnostics: browser }) => {
  await signIn(page, "documents-validation@example.com");
  const businessId = await createApprovedBusiness(browser, page, "E2E Validation Harbour");
  await page.goto(`/business/${businessId}/upload`);
  await page.getByRole("link", { name: "Español" }).click();
  const invalidResponse = await browserApiRequest(page, `/api/businesses/${businessId}/documents`, {
    method: "POST",
    multipart: { file: { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not a document") } },
  });
  expect(invalidResponse.status).toBe(400);
  expect(JSON.parse(invalidResponse.body)).toMatchObject({ error: { code: "UNSUPPORTED_DOCUMENT_FORMAT" } });
  await stubUploadResponse(page, 400, "UNSUPPORTED_DOCUMENT_FORMAT");
  await page.locator('input[type="file"]').setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("not a document") });
  await page.getByRole("button", { name: "Subir documento" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("formato");
  const oversizedResponse = await browserApiRequest(page, `/api/businesses/${businessId}/documents`, {
    method: "POST",
    multipart: { file: { name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) } },
  });
  expect(oversizedResponse.status).toBe(413);
  expect(JSON.parse(oversizedResponse.body)).toMatchObject({ error: { code: "DOCUMENT_TOO_LARGE" } });
  await stubUploadResponse(page, 413, "DOCUMENT_TOO_LARGE");
  await page.locator('input[type="file"]').setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) });
  await page.getByRole("button", { name: "Subir documento" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("10 MiB");
});

test("uploads and downloads a real progressive JPEG fixture", async ({ page, browserWithDiagnostics: browser }) => {
  await signIn(page, "documents-jpeg@example.com");
  const businessId = await createApprovedBusiness(browser, page, "E2E JPEG Harbour");
  await page.goto(`/business/${businessId}/upload`);
  await page.locator('input[type="file"]').setInputFiles(validProgressiveJpeg);
  await page.getByRole("button", { name: "Upload document" }).click();
  await expect(page.getByRole("status")).toContainText("uploaded");
  const link = page.getByRole("link", { name: "Download invoice.jpeg" });
  await expect(link).toBeVisible();
  const jpegHref = await link.getAttribute("href");
  if (!jpegHref) throw new Error("JPEG download link did not return an href");
  const response = await page.evaluate(async (href) => {
    const result = await fetch(href);
    return {
      status: result.status,
      contentType: result.headers.get("content-type"),
      length: (await result.arrayBuffer()).byteLength,
    };
  }, jpegHref);
  expect(response.status).toBe(200);
  expect(response.contentType).toBe("image/jpeg");
  expect(response.length).toBe(validProgressiveJpeg.buffer.length);
});

test("keeps upload usable on mobile with keyboard focus and reduced motion", async ({ page, browserWithDiagnostics: browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "documents-accessibility@example.com");
  const businessId = await createApprovedBusiness(browser, page, "E2E Accessibility Harbour");
  await page.goto(`/business/${businessId}/upload`);

  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  const fileInput = page.locator('input[type="file"]');
  const uploadButton = page.getByRole("button", { name: "Upload document" });
   const shellEnglish = page.getByRole("link", { name: "English" });
   const shellSpanish = page.getByRole("link", { name: "Español" });
   await shellEnglish.focus();
   await expect(shellEnglish).toBeFocused();
   await expect(shellEnglish).toHaveCSS("outline-style", "solid");
   await shellSpanish.focus();
   await expect(shellSpanish).toBeFocused();
   await page.getByRole("link", { name: /LedgerHarbour/ }).first().focus();
   await expect(page.getByRole("link", { name: /LedgerHarbour/ }).first()).toBeFocused();
   await fileInput.focus();
  await expect(fileInput).toBeFocused();
  await expect(fileInput).toHaveCSS("outline-style", "solid");
  await expect(fileInput).toHaveCSS("outline-width", "3px");
  await fileInput.setInputFiles(validPdf);
  await page.keyboard.press("Tab");
  await expect(uploadButton).toBeFocused();
  await expect(uploadButton).toHaveCSS("outline-style", "solid");
  await expect(uploadButton).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Shift+Tab");
  await expect(fileInput).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toContainText("uploaded");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const normalDuration = await uploadButton.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await uploadButton.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  expect(normalDuration).toBeGreaterThan(0.1);
  expect(reducedDuration).toBeLessThan(0.1);
  const styles = (await page.locator("style").allTextContents()).join("\n");
  expect(styles).toContain("prefers-reduced-motion");
});
