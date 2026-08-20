# LH-004 Production Status Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the repository's production-status documentation with versioned evidence while clearly labeling external provider state that remains unverified.

**Architecture:** This is a documentation-only change across three operational documents and the LH-004 record in `tasks.md`. `README.md` communicates the repository status, `docs/STACK.md` owns provider and architecture status, and `docs/production-activation.md` owns one-time activation versus recurring operational controls. No application code, configuration, secrets, providers, billing, deployment, or migrations are changed.

**Tech Stack:** Markdown, Git, PowerShell 5.1/.NET fallback scanning, existing repository documentation and test evidence.

## Global Constraints

- Only modify `README.md`, `docs/STACK.md`, `docs/production-activation.md`, and `tasks.md` during implementation.
- Historical specifications and plans remain unchanged.
- `tests/integration/postgres/native-schema.test.ts` is unrelated and remains outside the task.
- Local automated evidence proves local or deterministic behavior only.
- Configuration and runbooks prove intended contracts and operator steps, not external activation.
- Google Document AI, Cloudflare R2, and Upstash quotas, alerts, and scopes remain `unverified` until the LH-005 read-only verification is performed.
- Unsupported production facts must be labeled `unverified`, `pending`, or `operator-controlled`.
- Do not add secrets, tokens, private account identifiers, production rows, or billing details.
- Do not inspect dashboards, use credentials, enable billing, deploy, migrate, issue provider requests, or change application behavior.
- Keep LH-004 in `revision` until documentation QA and independent review pass.

---

### Task 1: Clarify README repository status

**Files:**
- Modify: `README.md:3-6` and the adjacent local-development/status text

**Interfaces:**
- Consumes: Existing local demo, verification commands, and production limitation statements.
- Produces: A repository-level status that distinguishes local verification, deterministic testing, implementation contracts, and unverified production activation.

- [ ] **Step 1: Inspect the current status block and preserve the local demo boundary**

  Confirm that the synthetic `admin@admin.com` flow, local adapters, and local URLs remain explicitly development-only. Do not remove the existing production limitation section.

- [ ] **Step 2: Replace the contradictory status header**

  Replace the current `MVP LOCAL VERIFICADO - NO LISTO PARA PRODUCCION` block with a concise status model containing these facts:

  ```markdown
  ## Estado del repositorio

  - Desarrollo local y pruebas deterministas: verificados en el alcance documentado.
  - Integraciones de proveedores: adapters y contratos implementados donde se indica en `docs/STACK.md`.
  - Operacion productiva: activacion y estado externo no revalidados por este repositorio; requieren evidencia del operador.
  ```

- [ ] **Step 3: Review README-only wording for unsupported readiness claims**

  Search the changed file for `produccion`, `production`, `ready`, `activat`, and `verific` and ensure every production statement either points to the activation gate or carries an explicit pending/unverified/operator-controlled qualifier.

- [ ] **Step 4: Run the focused documentation check**

  Run:

  ```powershell
  git diff --check -- README.md
  ```

  Expected: exit code `0` and no whitespace-error output.

- [ ] **Step 5: Commit the README change**

  ```powershell
  git add -- README.md
  git commit -m "docs: clarify repository production status"
  ```

---

### Task 2: Normalize provider status in STACK.md

**Files:**
- Modify: `docs/STACK.md:3-41` and `docs/STACK.md:57-65`
- Read: `docs/provider-alerts-limits-checklist.md`, `docs/production-activation.md`, provider-specific runbooks under `docs/`

**Interfaces:**
- Consumes: Existing stack descriptions, local verification documents, production gate contract, and the LH-005 provider checklist.
- Produces: A provider status matrix for Firebase, Neon, Vercel, Cloudflare R2, Upstash, and Google Document AI.

- [ ] **Step 1: Reconcile each existing provider statement with repository evidence**

  Use these status boundaries:

  | Provider | Implemented repository evidence | External/activation status |
  |---|---|---|
  | Firebase | Auth adapter and local contract documentation exist | `operator-controlled`; activation and identity boundary remain unverified |
  | Neon | PostgreSQL adapter, migrations, and local PGlite evidence exist | Native remote connection, production backup, and migration state remain `unverified` |
  | Vercel | Hosting target and production gate documentation exist | Deployment and current account/plan state remain `operator-controlled` or `unverified` |
  | Cloudflare R2 | Private storage adapter and local contract tests exist | Bucket, key scope, quotas, alerts, and activation remain `unverified` |
  | Upstash | Rate-limit adapter and local contract documentation exist | Redis/environment, limits, alerts, and activation remain `unverified` |
  | Google Document AI | Invoice Parser adapter and deterministic fake-OCR coverage exist | Processor, IAM, billing alert, quotas, and runtime activation remain `unverified` |

- [ ] **Step 2: Add the status matrix without changing cost facts**

  Add a `Estado documentado` matrix near the existing architecture section. Keep existing prices and quotas only as planning references, add a sentence that they are not current external verification, and link the matrix to `docs/production-activation.md` and `docs/provider-alerts-limits-checklist.md`.

- [ ] **Step 3: Correct contradictory Neon and activation language**

  Replace any wording that treats a remote Neon migration as current evidence when the repository's verification documents state that remote Neon was not used. Replace any wording that treats adapters, environment contracts, or the production gate as proof that a provider is active.

- [ ] **Step 4: Preserve security and production caveats**

  Keep the existing fail-closed production gate, private storage, secret-handling, backup, rollback, and no-billing warnings. Do not add real provider identifiers or values.

- [ ] **Step 5: Run the focused STACK checks**

  Run:

  ```powershell
  git diff --check -- docs/STACK.md
  ```

  Expected: exit code `0` and no whitespace-error output. Review the diff and confirm only the planned status/caveat text changed.

- [ ] **Step 6: Commit the STACK change**

  ```powershell
  git add -- docs/STACK.md
  git commit -m "docs: qualify provider production status"
  ```

---

### Task 3: Separate activation from recurring controls

**Files:**
- Modify: `docs/production-activation.md:1-57`
- Read: `docs/STACK.md`, `docs/provider-alerts-limits-checklist.md`, `docs/production-ordinary-user-verification.md`

**Interfaces:**
- Consumes: Existing activation contract, operator procedure, migration safeguards, and LH-005 recurring provider controls.
- Produces: A runbook whose one-time activation work is visibly separate from recurring controls and whose completion is never implied by the document itself.

- [ ] **Step 1: Add the runbook status disclaimer**

  Immediately after the opening gate paragraph, state that this file defines required operator actions and is not evidence that external activation has completed.

- [ ] **Step 2: Create the one-time activation section**

  Group the existing contract and operator steps under a heading such as `Activacion unica`. Keep the current gates for provider setup, secret loading, identity configuration, database readiness, production-gate health check, explicit deployment approval, and first-business approval.

- [ ] **Step 3: Add the recurring controls section**

  Add a separate `Controles recurrentes` section containing non-executing checks for provider quotas, billing/budget alerts, credential scopes, PostgreSQL backups and migration status, protected health checks, and manual suspension/recovery. Link R2, Upstash, and Document AI checks to the LH-005 checklist.

- [ ] **Step 4: Keep destructive and paid actions gated**

  Preserve explicit operator approval before deployment, migration, credential changes, billing changes, OCR requests, or remediation. State that recurring review records are required before labeling an external control verified.

- [ ] **Step 5: Run the focused activation checks**

  Run:

  ```powershell
  git diff --check -- docs/production-activation.md
  ```

  Expected: exit code `0` and no whitespace-error output. Read the resulting headings and confirm one-time and recurring controls are distinct.

- [ ] **Step 6: Commit the activation-runbook change**

  ```powershell
  git add -- docs/production-activation.md
  git commit -m "docs: separate activation and recurring controls"
  ```

---

### Task 4: Record documentation QA and independent review

**Files:**
- Modify: `tasks.md:183-201`
- Read: `README.md`, `docs/STACK.md`, `docs/production-activation.md`, `docs/provider-alerts-limits-checklist.md`

**Interfaces:**
- Consumes: The three completed document changes and their commit range.
- Produces: Reproducible LH-004 evidence, a clean documentation gate, and a review package that excludes unrelated worktree files.

- [ ] **Step 1: Run the exact repository scans**

  Run each command against the four in-scope files:

  ```powershell
  rg -n -i "secret|token|private[_ -]?key|service[_ -]?account|api[_ -]?key|password|billing account" README.md docs/STACK.md docs/production-activation.md tasks.md
  rg -n "TODO|TBD|FIXME|<email real>|<password real>|<real token>|<private account row>" README.md docs/STACK.md docs/production-activation.md tasks.md
  rg -n -i "MVP LOCAL|NO LISTO|production pending|provider pending|activat(e|ion).*pending|not ready for production" README.md docs/STACK.md docs/production-activation.md tasks.md
  ```

  Record `CommandNotFoundException` if `rg` is unavailable; do not substitute a claimed `rg` result.

- [ ] **Step 2: Run the PowerShell/.NET fallback scans when needed**

  If `rg` is unavailable, run this PowerShell 5.1 fallback from the repository root. It reports counts only and never prints matching content:

  ```powershell
  $files = @('README.md','docs/STACK.md','docs/production-activation.md','tasks.md')
  $secretPattern = '(?i)(sk_live_[a-z0-9]+|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|(?:api|access|secret|private)[_-]?key\s*[:=]\s*[\x27\"][^\x27\"]{12,}[\x27\"])'
  $placeholderPattern = '(?i)(TODO|TBD|FIXME|<email real>|<password real>|<real token>|<private account row>)'
  $secretMatches = 0
  $placeholderMatches = 0
  foreach ($file in $files) {
    $text = [System.IO.File]::ReadAllText((Join-Path (Get-Location) $file))
    $secretMatches += [regex]::Matches($text, $secretPattern).Count
    $placeholderMatches += [regex]::Matches($text, $placeholderPattern).Count
  }
  "secret_scan_matches=$secretMatches"
  "placeholder_scan_matches=$placeholderMatches"
  ```

  Record exact zero-match counts for the secret and placeholder scans. Review the intentional status words manually instead of treating every `pending` or `unverified` label as a contradiction.

- [ ] **Step 3: Review the complete documentation diff**

  Verify:

  ```powershell
  git diff --check 10ddbe2 HEAD
  git diff --name-only 10ddbe2 HEAD
  git status --short
  ```

  Expected: `git diff --check` exits `0`; changed names are limited to the three operational documents and `tasks.md`; the untracked `tests/integration/postgres/native-schema.test.ts` is explicitly excluded.

- [ ] **Step 4: Update LH-004 evidence without upgrading its state**

  Record the actual commands, fallback results, diff check, changed-file review, and the absence of provider/dashboard/billing/deployment activity under LH-004. Keep `State: revision` and state that external provider facts are not verified.

- [ ] **Step 5: Produce the independent review package**

  Generate a review package for the implementation commit range. Have an independent reviewer check every acceptance item, every provider row, every production claim, secret exposure, historical-file preservation, and the unrelated untracked test. Correct findings before the final review.

- [ ] **Step 6: Commit the QA record**

  ```powershell
  git add -- tasks.md
  git commit -m "docs: record production status documentation qa"
  ```

- [ ] **Step 7: Apply the final completion gate**

  Re-run `git diff --check` against the final documentation range, read the independent review result, and leave LH-004 in `revision` unless the operator later supplies current external evidence. Do not push, deploy, migrate, enable billing, or alter the unrelated untracked test.

## Final Verification Checklist

- [ ] `README.md` distinguishes local development, deterministic testing, implementation contracts, and unverified production activation.
- [ ] `docs/STACK.md` contains status coverage for Firebase, Neon, Vercel, R2, Upstash, and Document AI without overstating readiness.
- [ ] `docs/production-activation.md` separates one-time activation from recurring controls.
- [ ] Historical specs and plans are unchanged.
- [ ] Secret, placeholder, contradiction, and stale-status scans have real recorded results.
- [ ] `git diff --check` exits `0` for the full change range.
- [ ] No provider, billing, deployment, migration, credential, or application-code operation occurred.
- [ ] LH-004 remains `revision` pending current external evidence.
