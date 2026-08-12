# LedgerHarbour MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working LedgerHarbour slice for multi-business onboarding and document-first invoice capture, review, categorisation, and storage.

**Architecture:** Use a modular monolith in the `F:\Proyectos\LedgerHarbour\Dev` directory. The web application owns business logic and authorization, PostgreSQL stores relational data, a private storage adapter keeps originals, and OCR runs behind an asynchronous provider interface. Keep authentication and storage provider-neutral so Firebase Auth can be integrated later without changing finance modules.

**Tech Stack:** Next.js App Router, TypeScript, PostgreSQL, Drizzle ORM, Zod, `next-intl`, Vitest, Playwright, local private storage for development, and a deterministic fake OCR provider until an external provider and budget are explicitly approved.

## Global Constraints

- English is the default UI language; Spanish is available through a visible language selector.
- All code belongs under `F:\Proyectos\LedgerHarbour\Dev`.
- The business is the tenant and the authorization boundary.
- All business-scoped backend operations must verify membership and permission server-side.
- `Owner Admin`, `General Admin`, and `Administrator` are distinct permission policies.
- Business deactivation is soft state; financial data is never physically deleted by customer users.
- Original uploaded documents are private and retained after OCR.
- Supported initial files are PDF, JPG/JPEG, PNG, HEIC, and TIFF.
- The initial upload size limit is 10 MiB per file.
- GBP is the default base currency; EUR and USD are standard options; custom currencies support name, optional ISO code, symbol, and decimal count.
- Do not hardcode production credentials or create a production backdoor for `admin@admin.com`.
- Do not integrate a paid OCR provider or Firebase project without explicit operator approval and cost review.
- Do not deploy or apply production migrations from this plan.

---

## File Map

The implementation will use focused module boundaries:

- `src/app/`: Next.js routes, layouts, loading states, and route-level composition only.
- `src/modules/auth/`: authentication provider boundary and session mapping.
- `src/modules/tenancy/`: businesses, memberships, join requests, and tenant context.
- `src/modules/permissions/`: role capabilities and authorization decisions.
- `src/modules/documents/`: upload validation, storage adapter, and document state.
- `src/modules/invoices/`: invoice draft, OCR mapping, review, and approval.
- `src/modules/accounting/`: categories and currency configuration.
- `src/modules/audit/`: append-only audit events.
- `src/db/`: database client, schema, migrations, and test database helpers.
- `src/i18n/`: English and Spanish message catalogues and locale resolution.
- `src/ui/`: shared visual primitives and application shell.
- `tests/`: unit, integration, and Playwright scenarios.
- `storage/.private/`: ignored local development files only; never public web assets.

---

### Task 1: Bootstrap the Empty Application

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Test: `tests/e2e/smoke/app-starts.spec.ts`

**Interfaces:**
- Produces a runnable Next.js application and test commands for every later task.

- [ ] **Step 1: Create the package manifest** with scripts `dev`, `build`, `start`, `lint`, `test`, `test:watch`, and `test:e2e`; include only Next.js, React, TypeScript, Drizzle, Zod, `next-intl`, Vitest, and Playwright dependencies required by the plan.
- [ ] **Step 2: Add the minimum Next.js and TypeScript configuration** and make `src/app/page.tsx` render a plain temporary LedgerHarbour screen without financial behavior.
- [ ] **Step 3: Add `.env.example`** with non-secret sample values for `DATABASE_URL`, `AUTH_MODE`, `STORAGE_ROOT`, and `OCR_PROVIDER`; do not add real values.
- [ ] **Step 4: Add the Playwright smoke test** that requests the root page and asserts the response contains `LedgerHarbour`.
- [ ] **Step 5: Run `npm install`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e -- tests/e2e/smoke/app-starts.spec.ts`**; all must pass before continuing.

### Task 2: Define the Relational Domain Model

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema/users.ts`
- Create: `src/db/schema/businesses.ts`
- Create: `src/db/schema/memberships.ts`
- Create: `src/db/schema/join-requests.ts`
- Create: `src/db/schema/documents.ts`
- Create: `src/db/schema/invoices.ts`
- Create: `src/db/schema/categories.ts`
- Create: `src/db/schema/currencies.ts`
- Create: `src/db/schema/audit-events.ts`
- Create: `src/db/schema/jobs.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/migrations/0001_initial.sql`
- Create: `src/db/seed/default-categories.ts`
- Test: `tests/unit/db/schema.test.ts`

**Interfaces:**
- `BusinessId`, `UserId`, `MembershipId`, `DocumentId`, and `InvoiceId` are opaque string identifiers.
- `MembershipRole` is exactly `owner_admin | general_admin | administrator`.
- `JoinRequestStatus` is exactly `pending | approved | rejected`.
- `DocumentStatus` is exactly `uploaded | processing | needs_review | approved | failed`.
- Every tenant-owned table has a non-null `business_id`.

- [ ] **Step 1: Write schema tests** asserting required identifiers, membership role values, join-request state values, document state values, and tenant foreign keys.
- [ ] **Step 2: Define normalized tables** for users, businesses, memberships, join requests, documents, invoices, categories, currencies, audit events, and OCR jobs.
- [ ] **Step 3: Add uniqueness and indexes** for business names/search keys, one owner membership per business, one membership per user/business pair, pending join requests, invoice numbers within a business where present, and document processing state.
- [ ] **Step 4: Add the initial migration and default category seed** without destructive statements.
- [ ] **Step 5: Run the schema tests and migration parser** against a disposable PostgreSQL database; record the exact command and result in the task verification notes.

### Task 3: Implement Tenant Context and Permission Policies

**Files:**
- Create: `src/modules/tenancy/types.ts`
- Create: `src/modules/tenancy/tenant-context.ts`
- Create: `src/modules/permissions/roles.ts`
- Create: `src/modules/permissions/capabilities.ts`
- Create: `src/modules/permissions/authorize.ts`
- Test: `tests/unit/permissions/authorize.test.ts`
- Test: `tests/integration/tenancy/isolation.test.ts`

**Interfaces:**
- `getMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null>`
- `requireBusinessAccess(userId: UserId, businessId: BusinessId): Promise<Membership>`
- `can(role: MembershipRole, capability: Capability): boolean`
- `requireCapability(membership: Membership, capability: Capability): void`
- Capabilities include `read_finance`, `edit_finance`, `approve_administrator`, `remove_administrator`, `manage_general_admin`, `transfer_ownership`, `deactivate_business`, and `reactivate_business`.

- [ ] **Step 1: Write failing policy tests** for all three roles, including the rule that General Admin cannot manage another General Admin or the owner.
- [ ] **Step 2: Implement the capability matrix** as a pure function with no database or request dependencies.
- [ ] **Step 3: Implement tenant context lookup** that rejects missing membership, rejected membership, and inactive-business access.
- [ ] **Step 4: Add integration tests** proving a user from business A cannot read or mutate business B records even when they know an ID.
- [ ] **Step 5: Run unit and integration permission tests** and verify that no authorization decision depends only on frontend state.

### Task 4: Add Provider-Neutral Development Authentication

**Files:**
- Create: `src/modules/auth/auth-provider.ts`
- Create: `src/modules/auth/dev-auth-provider.ts`
- Create: `src/modules/auth/session.ts`
- Create: `src/modules/auth/auth-errors.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/ui/auth/AuthForm.tsx`
- Create: `src/i18n/messages/en.json`
- Create: `src/i18n/messages/es.json`
- Create: `src/i18n/config.ts`
- Test: `tests/unit/auth/dev-auth-provider.test.ts`
- Test: `tests/e2e/auth/login.spec.ts`

**Interfaces:**
- `AuthProvider.signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity>`
- `AuthProvider.signInWithGoogle(): Promise<AuthIdentity>`
- `AuthProvider.signOut(): Promise<void>`
- `AuthProvider.getCurrentIdentity(): Promise<AuthIdentity | null>`
- `AuthIdentity` contains only a provider user ID, email, display name, and verified-email flag.

- [ ] **Step 1: Write failing provider contract tests** for email sign-in, the development Google sign-in simulation, sign-out, and unauthenticated sessions.
- [ ] **Step 2: Implement `DevAuthProvider`** behind `AUTH_MODE=development`; use seeded test identities without embedding a production password or bypass route.
- [ ] **Step 3: Add English and Spanish message keys** for authentication, onboarding, invoices, errors, navigation, and roles; make missing keys fail in tests.
- [ ] **Step 4: Build login and registration screens** with a visible language switcher and accessible error states.
- [ ] **Step 5: Run auth unit tests and Playwright login tests**; verify the language switch preserves the route and does not mutate stored values.

### Task 5: Build Business Onboarding and Join Requests

**Files:**
- Create: `src/modules/tenancy/business-service.ts`
- Create: `src/modules/tenancy/join-request-service.ts`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/onboarding/create-business/page.tsx`
- Create: `src/app/onboarding/join-business/page.tsx`
- Create: `src/app/(app)/business/[businessId]/members/page.tsx`
- Create: `src/app/api/businesses/route.ts`
- Create: `src/app/api/businesses/search/route.ts`
- Create: `src/app/api/businesses/[businessId]/join-requests/route.ts`
- Test: `tests/unit/tenancy/business-service.test.ts`
- Test: `tests/integration/tenancy/join-requests.test.ts`
- Test: `tests/e2e/tenancy/onboarding.spec.ts`

**Interfaces:**
- `createBusiness(input: CreateBusinessInput, actorId: UserId): Promise<Business>`
- `searchBusinesses(query: string, actorId: UserId): Promise<BusinessSearchResult[]>`
- `requestMembership(input: JoinBusinessInput, actorId: UserId): Promise<JoinRequest>`
- `reviewJoinRequest(input: ReviewJoinRequestInput, actor: UserId): Promise<JoinRequest>`

- [ ] **Step 1: Write service tests** for creating a business with the creator as Owner Admin, searching by normalized name, rejecting duplicate memberships, and allowing reapplication after rejection.
- [ ] **Step 2: Implement business creation and default-category provisioning** in one transaction.
- [ ] **Step 3: Implement join-request creation and review** with server-side capability checks and explicit state transitions.
- [ ] **Step 4: Add API route validation** using Zod; return `400` for invalid input, `401` for missing identity, `403` for insufficient capability, `404` for hidden businesses, and `409` for conflicting membership state.
- [ ] **Step 5: Build onboarding and member-review screens** in English with Spanish translations and visible pending/rejected states.
- [ ] **Step 6: Run integration and E2E onboarding tests** for create, search, request, approve, reject, reapply, and cross-business isolation.

### Task 6: Implement Membership Administration and Business Lifecycle

**Files:**
- Create: `src/modules/tenancy/membership-service.ts`
- Create: `src/modules/tenancy/business-lifecycle-service.ts`
- Create: `src/app/(app)/business/[businessId]/settings/members/page.tsx`
- Create: `src/app/(app)/business/[businessId]/settings/danger-zone/page.tsx`
- Create: `src/app/api/businesses/[businessId]/members/[membershipId]/route.ts`
- Create: `src/app/api/businesses/[businessId]/ownership/transfer/route.ts`
- Create: `src/app/api/businesses/[businessId]/lifecycle/route.ts`
- Test: `tests/unit/tenancy/membership-service.test.ts`
- Test: `tests/integration/tenancy/lifecycle.test.ts`
- Test: `tests/e2e/tenancy/membership-administration.spec.ts`

**Interfaces:**
- `setGeneralAdmin(input: SetGeneralAdminInput, actorId: UserId): Promise<Membership>`
- `removeAdministrator(input: RemoveAdministratorInput, actorId: UserId): Promise<void>`
- `transferOwnership(input: TransferOwnershipInput, actorId: UserId): Promise<void>`
- `deactivateBusiness(businessId: BusinessId, actorId: UserId): Promise<void>`
- `reactivateBusiness(businessId: BusinessId, actorId: UserId): Promise<void>`

- [ ] **Step 1: Write failing tests** for owner-only General Admin assignment, General Admin removal of regular Administrators, blocked owner mutation, ownership transfer, and soft lifecycle state.
- [ ] **Step 2: Implement membership mutations** with transaction boundaries and audit-event creation.
- [ ] **Step 3: Implement ownership transfer** requiring a recent reauthentication marker and explicit confirmation token; demote the previous owner in the same transaction.
- [ ] **Step 4: Implement business deactivation/reactivation** and block new financial mutations while inactive.
- [ ] **Step 5: Build member settings and danger-zone UI** with confirmation dialogs that name the affected business and user.
- [ ] **Step 6: Run permission, lifecycle, and E2E tests** and verify audit entries for every successful mutation.

### Task 7: Implement Private Document Storage and Upload Validation

**Files:**
- Create: `src/modules/documents/storage-adapter.ts`
- Create: `src/modules/documents/local-private-storage.ts`
- Create: `src/modules/documents/file-validation.ts`
- Create: `src/modules/documents/document-service.ts`
- Create: `src/app/(app)/business/[businessId]/upload/page.tsx`
- Create: `src/app/api/businesses/[businessId]/documents/route.ts`
- Create: `src/app/api/documents/[documentId]/download/route.ts`
- Test: `tests/unit/documents/file-validation.test.ts`
- Test: `tests/integration/documents/private-storage.test.ts`
- Test: `tests/e2e/documents/upload.spec.ts`

**Interfaces:**
- `StorageAdapter.put(input: PrivateFileInput): Promise<StoredObject>`
- `StorageAdapter.get(objectKey: string): Promise<ReadableStream>`
- `validateUpload(input: UploadMetadata): ValidatedUpload`
- `createDocument(input: CreateDocumentInput, actorId: UserId): Promise<Document>`

- [ ] **Step 1: Write validation tests** for PDF, JPG/JPEG, PNG, HEIC, and TIFF acceptance plus extension spoofing, corrupted content, empty files, and size-limit rejection.
- [ ] **Step 2: Implement content-aware validation** using MIME sniffing and a 10 MiB per-file limit documented in the upload error message.
- [ ] **Step 3: Implement local private storage** under ignored `storage/.private/`; generated object keys must not contain raw user file names.
- [ ] **Step 4: Implement document creation** so the original file is stored before OCR is queued and the document is tenant-owned.
- [ ] **Step 5: Implement authorized download** through a backend route that checks business membership before reading the object.
- [ ] **Step 6: Run upload and private-storage tests** and manually verify that a document URL cannot be fetched as a public static asset.

### Task 8: Add OCR Provider Boundary and Invoice Drafts

**Files:**
- Create: `src/modules/invoices/ocr-provider.ts`
- Create: `src/modules/invoices/fake-ocr-provider.ts`
- Create: `src/modules/invoices/invoice-parser.ts`
- Create: `src/modules/invoices/invoice-service.ts`
- Create: `src/modules/jobs/job-service.ts`
- Create: `src/modules/jobs/ocr-worker.ts`
- Create: `src/app/api/documents/[documentId]/process/route.ts`
- Create: `src/app/api/invoices/[invoiceId]/route.ts`
- Test: `tests/unit/invoices/invoice-parser.test.ts`
- Test: `tests/unit/invoices/fake-ocr-provider.test.ts`
- Test: `tests/integration/invoices/ocr-workflow.test.ts`

**Interfaces:**
- `OcrProvider.extract(input: OcrInput): Promise<OcrResult>`
- `parseInvoice(result: OcrResult): InvoiceDraft`
- `queueOcr(documentId: DocumentId, actorId: UserId): Promise<Job>`
- `processOcrJob(jobId: string): Promise<void>`
- `approveInvoice(invoiceId: InvoiceId, actorId: UserId): Promise<Invoice>`

- [ ] **Step 1: Write parser fixtures** for supplier, invoice number, dates, subtotal, tax/GST, total, currency, and confidence values.
- [ ] **Step 2: Implement the deterministic fake provider** so tests do not call an external service or incur cost.
- [ ] **Step 3: Implement invoice parsing** with explicit nulls for missing fields and confidence per extracted field.
- [ ] **Step 4: Implement a bounded database-backed job state machine** with `queued`, `processing`, `completed`, and `failed` states and a maximum retry count.
- [ ] **Step 5: Connect document processing to invoice drafts** and set `needs_review` whenever required data is missing or confidence is below the configured threshold.
- [ ] **Step 6: Run all OCR and invoice integration tests** for success, timeout simulation, provider failure, retry exhaustion, and manual-review routing.

### Task 9: Add Categories, Currencies, and Invoice Review

**Files:**
- Create: `src/modules/accounting/category-service.ts`
- Create: `src/modules/accounting/currency-service.ts`
- Create: `src/modules/invoices/invoice-review-service.ts`
- Create: `src/app/(app)/business/[businessId]/invoices/page.tsx`
- Create: `src/app/(app)/business/[businessId]/invoices/[invoiceId]/page.tsx`
- Create: `src/app/(app)/business/[businessId]/settings/categories/page.tsx`
- Create: `src/app/(app)/business/[businessId]/settings/currencies/page.tsx`
- Create: `src/app/api/businesses/[businessId]/categories/route.ts`
- Create: `src/app/api/businesses/[businessId]/currencies/route.ts`
- Create: `src/app/api/invoices/[invoiceId]/review/route.ts`
- Test: `tests/unit/accounting/currency-service.test.ts`
- Test: `tests/integration/invoices/review.test.ts`
- Test: `tests/e2e/invoices/review.spec.ts`

**Interfaces:**
- `createCategory(input: CreateCategoryInput, actorId: UserId): Promise<Category>`
- `setCurrency(input: SetCurrencyInput, actorId: UserId): Promise<BusinessCurrency>`
- `updateInvoiceDraft(input: UpdateInvoiceDraftInput, actorId: UserId): Promise<Invoice>`
- `approveInvoice(invoiceId: InvoiceId, actorId: UserId): Promise<Invoice>`

- [ ] **Step 1: Write currency tests** for GBP default, EUR, USD, custom symbols, optional ISO codes, decimal counts, and invalid decimal ranges.
- [ ] **Step 2: Implement category and currency services** with business ownership checks and audit events for changes.
- [ ] **Step 3: Implement invoice draft editing** with server-side validation for totals, dates, currency, and category ownership.
- [ ] **Step 4: Build the invoice list and review screen** with original-document preview, extracted-field confidence indicators, manual corrections, and explicit approval.
- [ ] **Step 5: Build category and currency settings** with English and Spanish labels.
- [ ] **Step 6: Run invoice-review E2E tests** for upload-to-review, correction, approval, duplicate warning, and custom currency display.

### Task 10: Build the Multi-Business Application Shell

**Files:**
- Create: `src/modules/tenancy/portfolio-service.ts`
- Create: `src/ui/AppShell.tsx`
- Create: `src/ui/BusinessSwitcher.tsx`
- Create: `src/ui/LanguageSwitcher.tsx`
- Create: `src/ui/StatusBadge.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/business/[businessId]/page.tsx`
- Create: `src/app/(app)/portfolio/page.tsx`
- Test: `tests/integration/tenancy/portfolio.test.ts`
- Test: `tests/e2e/navigation/business-switcher.spec.ts`

**Interfaces:**
- `listUserBusinesses(userId: UserId): Promise<BusinessSummary[]>`
- `getBusinessDashboard(businessId: BusinessId, userId: UserId): Promise<DashboardSummary>`

- [ ] **Step 1: Write portfolio tests** proving a user sees only approved memberships and that switching business changes every business-scoped query.
- [ ] **Step 2: Implement the business switcher** with a server-validated active business ID.
- [ ] **Step 3: Implement the application shell** with `Upload`, `Needs review`, `Documents`, current business, settings, and language controls.
- [ ] **Step 4: Implement the first dashboard** with document counts, invoices needing review, and recent uploads; do not display invented financial totals.
- [ ] **Step 5: Run navigation E2E tests** for English, Spanish, portfolio switching, inactive-business blocking, and mobile-width layout.

### Task 11: Complete Security, Accessibility, and Release Verification

**Files:**
- Create: `tests/security/tenant-isolation.spec.ts`
- Create: `tests/security/upload-security.spec.ts`
- Create: `tests/security/permission-escalation.spec.ts`
- Create: `tests/e2e/critical-path.spec.ts`
- Create: `docs/verification/ledgerharbour-mvp-verification.md`
- Create: `README.md`

**Interfaces:**
- The verification document records exact commands, dates, pass/fail results, and unresolved risks.

- [ ] **Step 1: Run tenant-isolation tests** with users from at least two businesses and confirm no cross-tenant read, download, update, or approval succeeds.
- [ ] **Step 2: Run permission-escalation tests** for Owner Admin, General Admin, and Administrator boundaries, including ownership transfer reauthentication.
- [ ] **Step 3: Run upload-security tests** for MIME spoofing, path traversal names, oversized files, corrupted files, and unauthorized downloads.
- [ ] **Step 4: Run the full unit, integration, build, and Playwright suites** from a clean local environment.
- [ ] **Step 5: Perform the security self-review** against `security-baseline` and record findings before any release decision.
- [ ] **Step 6: Perform the relevant performance baseline** on upload, invoice list, and business switching before calling the MVP release-ready.

## Plan Self-Review

Spec coverage is mapped as follows:

- Product and differentiation: Tasks 1 and 10.
- English-first and Spanish selector: Tasks 4, 9, and 10.
- Multi-business tenancy: Tasks 2, 3, 5, 6, and 10.
- Membership permissions and lifecycle: Tasks 3, 5, and 6.
- Supported uploads and private storage: Task 7.
- OCR, review, and invoice fields: Task 8 and Task 9.
- Categories and currencies: Task 2 and Task 9.
- Security and auditability: Tasks 3, 5, 6, 7, and 11.
- Testing and release evidence: Task 11.

Every implementation step has a defined deliverable. Bank statements, reconciliation, line items, currency conversion, paid OCR, Firebase production configuration, and billing are explicitly deferred rather than left ambiguous.

The project directory is currently not a Git repository. The plan therefore uses verification checkpoints instead of requiring commits; no Git history will be created or changed without explicit operator instruction.
