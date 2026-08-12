# LedgerHarbour Design Specification

Date: 2026-08-11
Status: Approved for review before implementation
Project path: `F:\Proyectos\LedgerHarbour\Dev`

## Product

LedgerHarbour is a multi-business SaaS for small businesses and accountants. Its first workflow is document-first finance: upload an invoice, extract its main data, review it, and store it for later reporting and accounting workflows.

The product is English-first. A visible language selector will allow switching to Spanish. The language choice belongs to the user profile/session and must not change the stored financial data.

The initial market is Jersey, with a design that can expand to other countries.

## Value Proposition

LedgerHarbour will not compete with full accounting suites by copying every accounting feature. It will provide a simpler financial workspace for small businesses and accountants who need to collect, review, organise, and share financial documents.

The product differentiation is:

- A simple document-first workflow instead of a full accounting system.
- Multi-business access for accountants and operators.
- Explicit approval and review states for uncertain OCR results.
- Clear business-level permissions and audit history.
- GBP-first configuration with EUR, USD, and custom currencies.
- English-first UX with Spanish support.
- Jersey-oriented terminology and configuration without hardcoding one tax regime.

OCR alone is not considered a sufficient differentiator because competitors such as Dext and Hubdoc already provide document capture and extraction.

## Users and Tenancy

The business is the tenant and the security boundary. A user may belong to multiple businesses. A user sees and edits all financial information for every business in which they have an approved membership.

Commercial audiences:

- Small-business owners and operators.
- Accountants managing multiple businesses.

An internal platform administrator may exist for operational support. This account is separate from customer business memberships and is not part of the customer-facing permission model.

## Membership Permissions

### Owner Admin

- Full control of the business.
- Accept or reject membership requests.
- Assign or remove the General Admin permission.
- Transfer ownership to an approved administrator.
- Deactivate and reactivate the business.
- Change membership roles.

Ownership transfer requires explicit confirmation and reauthentication. The previous owner becomes a regular Administrator unless the new owner changes that permission.

### General Admin

- View and edit all business financial data.
- Accept, reject, and remove regular Administrators.
- Cannot create or remove another General Admin.
- Cannot modify, remove, or replace the Owner Admin.
- Cannot transfer ownership.

### Administrator

- View and edit all business financial data.
- Cannot approve, remove, or create administrators.
- Cannot change business ownership or elevated permissions.

All membership and permission changes are written to the audit history.

## Onboarding and Access

Authentication is planned for email and Google sign-in. The application will expose an authentication boundary so Firebase Auth can be integrated later without changing the business and finance modules. Production authentication must not depend on a hardcoded demo account.

After authentication, a user with no approved business membership can:

1. Create a new business by entering its name. The creator becomes Owner Admin.
2. Search for an existing business by name and submit a join request.

Join requests have explicit states: `pending`, `approved`, and `rejected`. A rejected user may submit a new request later. Approval is performed by the Owner Admin, or by a General Admin for regular Administrator requests.

## Invoice Workflow

The first demonstrable workflow is:

`Upload -> Validate -> Store original -> OCR -> Extract draft -> Review -> Approve -> Categorise`

Supported initial formats:

- PDF
- JPG/JPEG
- PNG
- HEIC
- TIFF

The original file is retained. OCR extracts only general invoice data in the first version:

- Supplier
- Invoice number
- Invoice date
- Due date
- Subtotal
- Tax or GST amount
- Total
- Currency
- Expense category
- Notes

Line-item extraction is deferred. Low-confidence or failed OCR results remain in manual review and are never silently approved.

## Categories and Currencies

Each new business receives a default editable expense category catalogue. Businesses can create, edit, or deactivate their own categories.

Currency configuration:

- GBP is the default base currency.
- EUR and USD are standard options.
- Other currency allows a custom name, optional ISO code, symbol, and decimal count.

The original invoice amount and currency are always preserved. Automatic conversion to GBP is deferred until exchange-rate handling is designed and verified.

## Architecture

LedgerHarbour will use a modular monolith. It will not start as independent microservices.

Initial modules:

- Authentication and sessions.
- Businesses and memberships.
- Documents and private file storage.
- Invoice extraction and review.
- Categories and currencies.
- Audit history.

The architecture will use:

- PostgreSQL for relational financial and membership data.
- Private object storage for original documents.
- Asynchronous jobs for OCR and other slow processing.
- Tenant-aware access checks at the backend and database layer.
- An authentication adapter prepared for Firebase Auth.

The backend owns validation, authorization, state transitions, and tenant isolation. The frontend must not be trusted to enforce permissions.

## Error Handling

The system must handle these states explicitly:

- Unsupported file type.
- File too large or corrupted.
- Duplicate document candidate.
- OCR timeout or provider failure.
- Low-confidence extracted fields.
- Missing required invoice fields.
- Unauthorized business access.
- Rejected or inactive business membership.

Files that fail OCR remain available for manual data entry. Background jobs use bounded retries and expose a visible processing state. Error messages shown to users must be useful without exposing internal details or sensitive data.

## Security and Data Protection

- Every business-scoped query must enforce tenant isolation.
- Private documents must not be publicly accessible.
- Uploads must be validated by content and extension, not extension alone.
- File names and extracted text must be treated as untrusted input.
- Audit records must be append-only for customer users.
- Secrets and provider credentials must come from environment configuration.
- Demo credentials must never become a production backdoor.
- Deactivation is soft state; business data is preserved.

## UX Direction

References reviewed:

- Dext: capture, extract, process, store, and collaborate.
- Hubdoc: mobile, email, and desktop document intake with extracted data.
- Xero: dashboard-led finance workflows and clear business navigation.

Design DNA:

- Tone: calm, clear, trustworthy, practical.
- Palette: deep navy for trust, sea teal for actions, warm off-white for surfaces, and a restrained coral accent for attention states.
- Typography: a clean sans-serif such as DM Sans or IBM Plex Sans for readable financial tables.
- Avoid: purple-gradient AI dashboards, dense spreadsheet-first layouts, and unexplained automation.

The primary navigation should make `Upload`, `Needs review`, `Documents`, and the current business visible. Accountants need a fast business switcher and a portfolio view without mixing tenant data.

## Deferred Scope

- Bank statement upload and transaction import.
- Bank reconciliation.
- Line-item OCR.
- Automatic currency conversion.
- Full accounting ledger.
- Payroll and fixed assets.
- External accounting integrations.
- Subscription billing and plan enforcement.
- Production Firebase Auth configuration.

## Verification Expectations

Before the first release, testing must cover:

- Unit tests for invoice parsing, currency validation, and membership state transitions.
- Integration tests for tenant isolation and permission boundaries.
- Upload tests for each supported file type and rejected files.
- OCR success, failure, timeout, and low-confidence fixtures.
- End-to-end tests for create business, request access, approve, reject, reapply, transfer ownership, deactivate, and reactivate.
- Language switching between English and Spanish without changing financial values.

No implementation task is complete until security review and the relevant tests have real passing evidence.
