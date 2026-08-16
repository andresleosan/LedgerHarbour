# Google Document AI Invoice OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace production fake OCR with Google Document AI Invoice Parser and connect explicit document processing to the existing invoice review flow.

**Architecture:** Keep `OcrProvider` as the application boundary. Add a Google adapter with an injectable client, a configuration factory that fails closed, and a worker error classification that retries only transient provider failures. The existing process endpoint will queue and execute the job inline for this prototype; the upload page will expose an explicit OCR action and route successful jobs to the existing invoice list/review pages.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@google-cloud/documentai@10.0.0`, Zod, Vitest, Playwright, Vercel Hobby, Cloudflare R2, PostgreSQL/in-memory persistence.

## Global Constraints

- Use `OCR_PROVIDER=google-document-ai` explicitly in production; never silently fall back to `FakeOcrProvider`.
- Keep `OCR_PROVIDER=fake` for local development and deterministic tests.
- Store Google credentials only in runtime environment secrets; never log credentials, document bytes, or full provider responses.
- Use Google Document AI Invoice Parser online processing; do not add batch processing, a scheduler, a new queue service, or a schema migration.
- Preserve tenant authorization before private storage reads and before provider calls.
- Retry only transient provider failures with the existing maximum of three worker attempts; configuration and non-retryable 4xx failures terminate immediately.
- The user must explicitly click OCR processing after upload; upload alone must not incur an OCR request.
- Do not create Google Cloud resources, enable billing, configure production secrets, deploy, or run a paid OCR request without explicit operator confirmation.
- Validate all external input and return generic public errors without provider internals.

---

## File Map

- Create: `src/modules/invoices/google-document-ai-provider.ts` - Google client boundary, entity mapping, normalized value conversion, and provider error translation.
- Create: `src/modules/invoices/ocr-provider-factory.ts` - `OCR_PROVIDER` selection and secret/configuration validation.
- Create: `tests/unit/invoices/google-document-ai-provider.test.ts` - Document AI response mapping and provider error tests.
- Create: `tests/unit/invoices/ocr-provider-factory.test.ts` - Provider selection and fail-closed configuration tests.
- Modify: `src/modules/invoices/ocr-provider.ts` - Add provider error classification types shared by adapters and workers.
- Modify: `src/modules/jobs/ocr-worker.ts` - Use the provider factory by default and terminate non-retryable errors without repeated calls.
- Modify: `src/app/api/documents/[documentId]/process/route.ts` - Execute the queued job and return its final job state for the prototype flow.
- Modify: `tests/integration/invoices/ocr-workflow.test.ts` - Update process route expectations and cover terminal provider failures.
- Modify: `src/app/(app)/business/[businessId]/upload/page.tsx` - Add the explicit `Procesar con OCR` action and navigation after processing.
- Modify: `src/i18n/messages/en.json` - Add English OCR processing labels and errors.
- Modify: `src/i18n/messages/es.json` - Add Spanish OCR processing labels and errors.
- Modify: `.env.example` - Document the provider selector and Google settings without secrets.
- Modify: `docs/STACK.md` - Record the integration, cost estimate, and billing alert requirement.
- Create: `docs/google-document-ai.md` - Setup, IAM, secret handling, limits, retries, and operational fallback.
- Create: `docs/superpowers/specs/2026-08-16-authenticated-shell-visual-language-design.md` - Approved visual DNA and language consolidation rules.
- Modify: `src/ui/AppShell.tsx`, `src/ui/LanguageSwitcher.tsx` - Single global language control and shared visual tokens.
- Modify: `src/ui/useUrlLocale.ts` - Preserve pathname and functional query params during locale changes.
- Modify: `src/app/(app)/business/[businessId]/upload/page.tsx`, `src/app/(app)/business/[businessId]/invoices/page.tsx`, `src/app/(app)/business/[businessId]/invoices/[invoiceId]/page.tsx` - Remove duplicate toolbars and align operational surfaces.
- Modify: `src/app/(app)/business/[businessId]/members/page.tsx`, `src/app/(app)/business/[businessId]/settings/categories/page.tsx`, `src/app/(app)/business/[businessId]/settings/currencies/page.tsx`, `src/app/(app)/business/[businessId]/settings/members/page.tsx`, `src/app/(app)/business/[businessId]/settings/danger-zone/page.tsx` - Remove duplicate language controls and use shared shell styling.
- Modify: `tests/e2e/navigation/business-switcher.spec.ts` - Verify one authenticated language control, locale preservation, responsive layout, focus, and reduced motion.
- Modify: `package.json`, `pnpm-lock.yaml` - Add the pinned Google Document AI dependency.

---

### Task 1: Implement Google Invoice Provider

**Files:**
- Create: `src/modules/invoices/google-document-ai-provider.ts`
- Create: `tests/unit/invoices/google-document-ai-provider.test.ts`
- Modify: `src/modules/invoices/ocr-provider.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `OcrProvider`, `OcrInput`, `OcrResult` from `src/modules/invoices/ocr-provider.ts`.
- Produces: `GoogleDocumentAiInvoiceProvider`, `GoogleDocumentAiClient`, `GoogleDocumentAiProviderOptions`, and `OcrProviderError` for the factory and worker.

- [ ] **Step 1: Add the exact client dependency**

Run:

```bash
corepack pnpm add @google-cloud/documentai@10.0.0
```

Expected: `package.json` and `pnpm-lock.yaml` contain `@google-cloud/documentai` at version `10.0.0`.

- [ ] **Step 2: Write failing mapping tests**

Add tests with an injected client that returns these entities:

```ts
const documentAiResponse = {
  entities: [
    { type: "supplier_name", mentionText: "Acme Ltd", confidence: 0.92 },
    { type: "invoice_id", mentionText: "INV-42", confidence: 0.88 },
    { type: "invoice_date", normalizedValue: { dateValue: { year: 2026, month: 8, day: 16 } }, confidence: 0.91 },
    { type: "net_amount", normalizedValue: { moneyValue: { units: "100", nanos: 500000000, currencyCode: "GBP" } }, confidence: 0.86 },
    { type: "total_tax_amount", mentionText: "20.10", confidence: 0.84 },
    { type: "total_amount", mentionText: "120.60", confidence: 0.93 },
    { type: "currency", mentionText: "GBP", confidence: 0.99 },
  ],
};
```

Assert that `extract()` returns ISO date `2026-08-16`, decimal strings, mapped confidence values, `null` for missing due date/category/notes, and a request containing the configured processor name, original MIME type, and original bytes.

Add tests for a missing entity, a malformed normalized date, a malformed money value, and a client rejection translated to `OcrProviderError` without exposing the original error text.

- [ ] **Step 3: Run only the new tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/invoices/google-document-ai-provider.test.ts
```

Expected: FAIL because `GoogleDocumentAiInvoiceProvider` and `OcrProviderError` do not exist yet.

- [ ] **Step 4: Add the shared provider error contract**

In `ocr-provider.ts`, add:

```ts
export class OcrProviderError extends Error {
  readonly name = "OcrProviderError";

  constructor(readonly retryable: boolean) {
    super("OCR provider request failed.");
  }
}
```

The constructor must not accept or store provider response text.

- [ ] **Step 5: Implement the provider and mapping helpers**

Implement `GoogleDocumentAiInvoiceProvider` with constructor options `{ client, processorName }` and `extract(input)` that:

1. Converts `input.data` to a `Buffer` only at the provider boundary.
2. Calls `client.processDocument({ name: processorName, rawDocument: { content, mimeType: input.mimeType } })` exactly once.
3. Selects the first entity for each mapped type.
4. Uses `mentionText` first, then normalized date or money values.
5. Converts `moneyValue.units` and `moneyValue.nanos` to a non-negative decimal string without scientific notation.
6. Converts `dateValue` to `YYYY-MM-DD` only when year, month, and day are valid integers.
7. Assigns confidence `0` to absent fields.
8. Converts provider exceptions to `OcrProviderError`, marking status `429`, `500`, `502`, `503`, `504`, and equivalent transient numeric gRPC codes as retryable; permission, authentication, invalid argument, and not-found errors are non-retryable.

Use a narrow `GoogleDocumentAiClient` interface so tests never instantiate the Google SDK.

- [ ] **Step 6: Run the provider tests and verify GREEN**

Run:

```bash
corepack pnpm exec vitest run tests/unit/invoices/google-document-ai-provider.test.ts
```

Expected: all provider mapping, malformed response, request, and error classification tests pass.

- [ ] **Step 7: Commit the provider boundary**

```bash
git add package.json pnpm-lock.yaml src/modules/invoices/ocr-provider.ts src/modules/invoices/google-document-ai-provider.ts tests/unit/invoices/google-document-ai-provider.test.ts
git commit -m "feat: add Google Document AI invoice provider"
```

---

### Task 2: Add Explicit Provider Factory

**Files:**
- Create: `src/modules/invoices/ocr-provider-factory.ts`
- Create: `tests/unit/invoices/ocr-provider-factory.test.ts`

**Interfaces:**
- Consumes: `GoogleDocumentAiInvoiceProvider` and `FakeOcrProvider` from Task 1.
- Produces: `createOcrProvider(env?: NodeJS.ProcessEnv): OcrProvider` and `OcrConfigurationError` for `ocr-worker.ts`.

- [ ] **Step 1: Write failing factory tests**

Cover these exact cases:

```ts
expect(createOcrProvider({ OCR_PROVIDER: "fake" })).toBeInstanceOf(FakeOcrProvider);
expect(() => createOcrProvider({ OCR_PROVIDER: "google-document-ai" })).toThrowError(OcrConfigurationError);
expect(() => createOcrProvider({ OCR_PROVIDER: "unsupported" })).toThrowError(OcrConfigurationError);
```

Also verify that a complete Google configuration constructs the provider without exposing `GOOGLE_SERVICE_ACCOUNT_JSON` in thrown error messages.

- [ ] **Step 2: Run the factory tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/unit/invoices/ocr-provider-factory.test.ts
```

Expected: FAIL because the factory and configuration error do not exist.

- [ ] **Step 3: Implement configuration validation and SDK construction**

Implement `createOcrProvider(env = process.env)` with these rules:

- `fake` returns `new FakeOcrProvider()`.
- `google-document-ai` requires `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, and `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Parse the service-account JSON inside the factory and pass it as `credentials` to `DocumentProcessorServiceClient`.
- Configure `apiEndpoint` as `${location}-documentai.googleapis.com`.
- Build processor name exactly as `projects/${projectId}/locations/${location}/processors/${processorId}`.
- Wrap the SDK client in the narrow `GoogleDocumentAiClient` interface from Task 1.
- Treat empty, malformed, or unsupported configuration as `OcrConfigurationError("OCR provider configuration is invalid.")`.
- Do not include secret values, JSON parse details, project credentials, or SDK error text in the public error.

- [ ] **Step 4: Run factory tests and the provider regression**

Run:

```bash
corepack pnpm exec vitest run tests/unit/invoices/ocr-provider-factory.test.ts tests/unit/invoices/google-document-ai-provider.test.ts
```

Expected: all tests pass and no Google network request is made.

- [ ] **Step 5: Commit the factory**

```bash
git add src/modules/invoices/ocr-provider-factory.ts tests/unit/invoices/ocr-provider-factory.test.ts
git commit -m "feat: select OCR provider from runtime configuration"
```

---

### Task 3: Wire Provider Errors into the Worker

**Files:**
- Modify: `src/modules/jobs/ocr-worker.ts`
- Modify: `tests/integration/invoices/ocr-workflow.test.ts`

**Interfaces:**
- Consumes: `createOcrProvider`, `OcrProviderError`, and `OcrConfigurationError` from Tasks 1-2.
- Produces: Existing `createOcrWorker()` behavior with default provider selection and terminal/non-terminal failure handling.

- [ ] **Step 1: Add failing worker tests**

Add a test with an injected provider that throws `new OcrProviderError(false)` and assert after one `processOcrJob()` call that the job is `failed`, `retryCount` is `3`, the document is `failed`, and the provider is not invoked again by subsequent calls.

Add a transient error test with `new OcrProviderError(true)` and assert the retry count increments from `0` to `1` while the job remains retryable.

- [ ] **Step 2: Run the focused workflow test and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/integration/invoices/ocr-workflow.test.ts
```

Expected: the new classification assertions fail because the worker currently retries every caught error.

- [ ] **Step 3: Implement worker classification and factory default**

Change the default provider from `new FakeOcrProvider()` to `createOcrProvider()`.

Add a terminal failure helper that updates the job with `status: "failed"`, `retryCount: 3`, `errorSummary: "OCR processing failed."`, and the current timestamp. In the catch block:

```ts
if (error instanceof OcrProviderError && !error.retryable) {
  await failJobTerminal(processing ?? job, jobs);
} else {
  await failJob(processing ?? job, jobs);
}
```

Treat `OcrConfigurationError` as terminal. Keep all existing authorization, private-read ordering, duplicate protection, and generic error behavior unchanged.

- [ ] **Step 4: Run the complete OCR workflow tests**

Run:

```bash
corepack pnpm exec vitest run tests/integration/invoices/ocr-workflow.test.ts
```

Expected: all existing workflow tests plus the new retry classification tests pass.

- [ ] **Step 5: Commit the worker wiring**

```bash
git add src/modules/jobs/ocr-worker.ts tests/integration/invoices/ocr-workflow.test.ts
git commit -m "feat: use configured OCR provider in worker"
```

---

### Task 4: Connect Processing to the UI

**Files:**
- Modify: `src/app/api/documents/[documentId]/process/route.ts`
- Modify: `tests/integration/invoices/ocr-workflow.test.ts`
- Modify: `src/app/(app)/business/[businessId]/upload/page.tsx`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/es.json`

**Interfaces:**
- Consumes: `queueOcr`, `processOcrJob`, and `PersistenceContext` from the existing job/persistence modules.
- Produces: `POST /api/documents/:documentId/process` returning `{ job }` with the final job state for the inline prototype flow; upload UI navigates to the invoice list on completion.

- [ ] **Step 1: Write failing route and UI behavior tests**

Extend the integration route test so a valid process request returns status `202` with `job.status === "completed"` and creates one invoice without a second manual `processOcrJob()` call.

Add a terminal provider failure route test that returns status `502` with `{ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } }` and does not expose provider text.

Keep the existing `401`, `400`, `403`, `404`, and `409` assertions.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
corepack pnpm exec vitest run tests/integration/invoices/ocr-workflow.test.ts
```

Expected: the valid route still returns a queued job and the new final-state assertion fails.

- [ ] **Step 3: Execute the worker in the process route**

After `queueOcr()` returns, call `processOcrJob(job.id, { tenancyRepository, documentRepository, jobs, invoices, storage })`. Read the job again from `persistence.jobRepository` and return it.

- Return `202` when the job reaches `completed`.
- Return `502` with the generic `OCR_PROCESSING_FAILED` response when the job reaches `failed`.
- Preserve the existing `JobError` status mapping before the worker call.
- Do not return Google response data, job internals beyond the existing safe job DTO, or secret/configuration details.

- [ ] **Step 4: Add the explicit upload action**

In `upload/page.tsx`, keep the uploaded document state and add `processing` state. After upload, render a button labeled by `copy.processAction`. Its handler calls:

```ts
fetch(`/api/documents/${document.id}/process`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
```

On a successful response, navigate to `/business/${businessId}/invoices?locale=${locale}`. On failure, render `copy.processingError`; disable both upload and process buttons while busy. Keep the private download link visible.

- [ ] **Step 5: Add both locale dictionaries**

Add matching keys to `documents` in `en.json` and `es.json`:

```json
"processAction": "Process with OCR",
"processing": "Processing...",
"processingError": "The document could not be processed with OCR."
```

Use Spanish equivalents in `es.json`, and update the component to use these keys rather than hardcoded text.

- [ ] **Step 6: Run route, type, and lint checks**

Run:

```bash
corepack pnpm exec vitest run tests/integration/invoices/ocr-workflow.test.ts
corepack pnpm lint
```

Expected: all route/workflow tests pass and lint reports no errors.

- [ ] **Step 7: Commit the end-to-end trigger**

```bash
git add src/app/api/documents/[documentId]/process/route.ts tests/integration/invoices/ocr-workflow.test.ts src/app/(app)/business/[businessId]/upload/page.tsx src/i18n/messages/en.json src/i18n/messages/es.json
git commit -m "feat: connect document upload to OCR review flow"
```

---

### Task 5: Document Runtime Configuration and Cost Controls

**Files:**
- Modify: `.env.example`
- Modify: `docs/STACK.md`
- Create: `docs/google-document-ai.md`

**Interfaces:**
- Consumes: Runtime variables and behavior delivered by Tasks 1-4.
- Produces: Operator setup documentation without credentials or resource creation performed by the agent.

- [ ] **Step 1: Write the environment contract**

Update `.env.example` to replace `OCR_PROVIDER=none` with:

```text
OCR_PROVIDER=fake
GOOGLE_CLOUD_PROJECT_ID=replace-with-google-cloud-project-id
GOOGLE_CLOUD_LOCATION=us
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=replace-with-invoice-parser-id
GOOGLE_SERVICE_ACCOUNT_JSON=replace-with-json-secret
```

Keep all values non-secret examples and state in comments that production must use the secret manager.

- [ ] **Step 2: Write the integration runbook**

Create `docs/google-document-ai.md` covering:

- Create or select a Google Cloud project and enable Document AI API.
- Create an Invoice Parser processor in `us` or `eu` and record its processor ID.
- Create a dedicated service account with the predefined `roles/documentai.apiUser` role, which grants online and batch processing without processor administration permissions.
- Store the JSON credential in Vercel as `GOOGLE_SERVICE_ACCOUNT_JSON`, never in Git or a browser.
- Set `OCR_PROVIDER=google-document-ai` only after all four Google variables exist.
- Use synchronous online processing limits of 15 pages.
- Explain 4xx terminal errors, transient retries, generic client errors, and the `FakeOcrProvider` local fallback.
- Record the official price of `US$0.10` per invoice-parser count of up to 10 pages and require a Google Cloud budget alert before production activation.

- [ ] **Step 3: Update stack status and cost table**

Change `docs/STACK.md` from fake OCR pending to an adapter implemented/configuration pending state. Add Google Document AI to the cost table with the official price range and `billing alert: required/not verified` until the operator configures it.

- [ ] **Step 4: Review docs for secret leakage and formatting**

Run:

```bash
git diff --check
corepack pnpm audit --json
```

Expected: no whitespace errors, no credential-like value in the new docs, and zero known dependency vulnerabilities.

- [ ] **Step 5: Commit the runbook**

```bash
git add .env.example docs/STACK.md docs/google-document-ai.md
git commit -m "docs: document Google Document AI setup and cost"
```

---

### Task 6: Minimal Authenticated Visual System and Language Consolidation

**Files:**
- Modify: `src/ui/AppShell.tsx`
- Modify: `src/ui/LanguageSwitcher.tsx`
- Modify: `src/ui/useUrlLocale.ts`
- Modify: `src/app/(app)/business/[businessId]/upload/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/invoices/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/invoices/[invoiceId]/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/members/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/settings/categories/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/settings/currencies/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/settings/members/page.tsx`
- Modify: `src/app/(app)/business/[businessId]/settings/danger-zone/page.tsx`
- Modify: `tests/e2e/navigation/business-switcher.spec.ts`
- Reference: `docs/superpowers/specs/2026-08-16-authenticated-shell-visual-language-design.md`

**Interfaces:**
- Consumes: `LanguageSwitcher`, `useUrlLocale`, existing `AppShell` navigation and the approved Design DNA.
- Produces: One authenticated language control, consistent operational surface primitives, preserved locale/filter query parameters, and responsive accessible pages.

- [ ] **Step 1: Add failing browser assertions for the duplicate-control bug**

Extend `tests/e2e/navigation/business-switcher.spec.ts` after navigating to an authenticated business route:

```ts
await expect(page.locator(".language-switcher")).toHaveCount(1);
await expect(page.locator(".toolbar")).toHaveCount(0);
await expect(page.getByRole("link", { name: "Español" })).toHaveAttribute("href", /locale=es/);
```

Keep assertions that the current pathname, invoice filter, focus outline, reduced-motion transition, contrast, and mobile `scrollWidth` remain valid.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/navigation/business-switcher.spec.ts
```

Expected: the new count assertion fails because the authenticated upload page and other pages render their own language toolbar in addition to `AppShell`.

- [ ] **Step 3: Make `AppShell` the only authenticated language owner**

Move `LanguageSwitcher` into the global header utility area beside the signed-in user controls. Keep its accessible `aria-label`, English/Spanish labels, and URL generation, but render it as a compact segmented control with one active state, visible keyboard focus, and no repeated visible `Language/Idioma` label on each page.

Add CSS variables in `AppShell` for the approved palette and shared control states. Keep contrast at 4.5:1 or higher, use only short hover/focus transitions, and preserve reduced-motion behavior.

- [ ] **Step 4: Remove local language toolbars without losing locale behavior**

Remove the local toolbar markup and its redundant styles from upload, invoices list, invoice review, members, categories, currencies, settings members, and danger-zone pages. Keep each page's `locale` resolution and `hrefFor` calls where they are needed for links, filters, copy, and redirects. Do not remove auth/onboarding selectors in this task.

Update `useUrlLocale` and the server-side invoice filter links so changing language preserves all functional query parameters, especially `status` on invoices. The shell selector must preserve the current pathname and query string rather than reconstructing a page-specific URL.

- [ ] **Step 5: Normalize the operational visual primitives**

Use the shared shell tokens in the touched pages to align:

- one card radius and border treatment;
- one primary teal button and one secondary action treatment;
- consistent input height, focus ring, badge shape, and error/success colors;
- moderate page headings instead of oversized upload/review titles;
- mobile single-column layout with no horizontal overflow;
- keyboard focus and `prefers-reduced-motion` behavior.

Do not add Tailwind, shadcn/ui, Magic UI, or Aceternity UI as mandatory dependencies; extract only the structural patterns from the approved references.

- [ ] **Step 6: Run focused browser and static verification**

Run:

```bash
corepack pnpm exec playwright test tests/e2e/navigation/business-switcher.spec.ts
corepack pnpm lint
corepack pnpm build
```

Expected: the browser test passes in English and Spanish, the authenticated route contains one `.language-switcher`, no `.toolbar`, the mobile viewport has no overflow, and lint/build exit successfully.

- [ ] **Step 7: Commit the visual pass**

```bash
git add src/ui/AppShell.tsx src/ui/LanguageSwitcher.tsx src/ui/useUrlLocale.ts src/app/(app)/business/[businessId] tests/e2e/navigation/business-switcher.spec.ts
git commit -m "feat: simplify authenticated visual language"
```

---

### Task 7: Full Verification and Production Gate

**Files:**
- Modify: `tasks.md` if present, otherwise record status in the final handoff only.
- No production files are changed in this task.

**Interfaces:**
- Consumes: All code and documentation from Tasks 1-5.
- Produces: Evidence for local approval and a separate operator-controlled production activation step.

- [ ] **Step 1: Run the complete local test suite**

Run:

```bash
corepack pnpm test
```

Expected: zero failed tests; report the exact passed/skipped totals.

- [ ] **Step 2: Run static and build verification**

Run:

```bash
corepack pnpm lint
corepack pnpm build
corepack pnpm audit --json
```

Expected: lint exits `0`, build completes, and audit reports `critical: 0`, `high: 0`, `moderate: 0`, and `low: 0`.

- [ ] **Step 3: Run local browser verification with fake OCR**

With `OCR_PROVIDER=fake`, use Playwright MCP to authenticate, upload a valid non-sensitive fixture, click `Process with OCR`, verify navigation to the invoice list, open review, edit a low-confidence field, and confirm approval. Capture the result and console errors.

- [ ] **Step 4: Perform the security review**

Verify that process and review routes require identity and tenant membership, provider responses and secrets are absent from logs/DTOs, R2 remains private, non-retryable provider errors terminate, and no new dependency or secret appears in Git history.

- [ ] **Step 5: Stop before paid production activation**

Do not set production Google credentials, enable billing, send a real paid request, or deploy from this task. Present the operator with the exact required variables, processor ID requirement, billing-alert requirement, and the E2E command/result needed after manual configuration.
