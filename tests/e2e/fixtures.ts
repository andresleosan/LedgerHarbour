import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

import { attachPageDiagnostics, createBrowserDiagnostics } from "./fixtures/browser-diagnostics";

type DiagnosticFixtures = {
  diagnostics: ReturnType<typeof createBrowserDiagnostics>;
  browserWithDiagnostics: DiagnosticBrowser;
};

export interface DiagnosticBrowser {
  newPage(options?: BrowserContextOptions): Promise<Page>;
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
}

export const test = base.extend<DiagnosticFixtures>({
  diagnostics: [async ({}, use) => {
    const diagnostics = createBrowserDiagnostics();
    await use(diagnostics);
    diagnostics.assertClean();
  }, { auto: true }],
  context: async ({ context, diagnostics }, use) => {
    context.on("page", (page) => attachPageDiagnostics(page, diagnostics));
    await use(context);
  },
  page: async ({ page, diagnostics }, use) => {
    attachPageDiagnostics(page, diagnostics);
    await use(page);
  },
  browserWithDiagnostics: async ({ browser, diagnostics }, use) => {
    const attachContext = (context: BrowserContext) => {
      context.on("page", (page) => attachPageDiagnostics(page, diagnostics));
      return context;
    };

    const diagnosticBrowser: DiagnosticBrowser = {
      async newPage(options) {
        const page = await browser.newPage(options);
        attachPageDiagnostics(page, diagnostics);
        return page;
      },
      async newContext(options) {
        return attachContext(await browser.newContext(options));
      },
    };

    await use(diagnosticBrowser);
  },
});

export { expect };
