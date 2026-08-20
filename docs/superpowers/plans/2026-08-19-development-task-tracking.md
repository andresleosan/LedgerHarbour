# Development Task Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a canonical root `tasks.md` that tracks LedgerHarbour corrections, functional work, operations, future improvements, and recently deployed work.

**Architecture:** Keep task state in one human-readable Markdown file and link detailed design context instead of duplicating implementation plans. Order active work first by priority and then by simplified RICE score; preserve deployed work in a compact history section.

**Tech Stack:** Markdown, Git, existing LedgerHarbour documentation and verification workflow.

## Global Constraints

- `tasks.md` is the canonical task-status source; historical specs and plans remain supporting detail.
- Sections are exactly P0 production risks, P1 incomplete functional flows, P2 operations/documentation, P3 future improvements, and recently completed work.
- Active task IDs are stable and sequential from `LH-001` through `LH-008`.
- States are exactly `pendiente`, `en progreso`, `revision`, `aprobada`, `desplegada`, and `bloqueada`.
- No task becomes `aprobada` without real security and test evidence.
- Production, billing, migrations, destructive operations, and new spending require explicit operator confirmation.
- Do not change historical specs merely because their status headings are stale.
- Do not modify or stage the unrelated `tests/integration/postgres/native-schema.test.ts` file.
- Do not commit without separate operator authorization.

## File Structure

- Create `tasks.md`: canonical active backlog, workflow rules, detailed acceptance criteria, and recent deployment history.
- Reference `docs/superpowers/specs/2026-08-19-development-task-tracking-design.md`: approved source for task content and scoring; do not duplicate or alter it during implementation.

---

### Task 1: Canonical Development Backlog

**Files:**
- Create: `tasks.md`
- Reference: `docs/superpowers/specs/2026-08-19-development-task-tracking-design.md`

**Interfaces:**
- Consumes: the approved task IDs, priorities, RICE values, states, acceptance criteria, and maintenance rules from the design spec.
- Produces: one root-level Markdown backlog used by future development sessions to select and update work.

- [ ] **Step 1: Confirm the canonical file does not already exist**

Run:

```powershell
Test-Path -LiteralPath "tasks.md"
```

Expected: `False`. If it returns `True`, read the file and merge deliberately instead of overwriting it.

- [ ] **Step 2: Create the backlog header and workflow contract**

Create `tasks.md` with:

```markdown
# LedgerHarbour Development Tasks

Updated: 2026-08-19

This file is the canonical source for development status. Specs and plans provide detail but do not override the state recorded here.

## Workflow

- Priorities: P0 production risk, P1 incomplete product flow, P2 operations/documentation, P3 future improvement.
- States: `pendiente`, `en progreso`, `revision`, `aprobada`, `desplegada`, `bloqueada`.
- Keep at most one coordinator task `en progreso`.
- Approval requires recorded security review and real test evidence.
- Deployment requires commit, successful deployment, and production verification when applicable.
- Critical security findings move a task to `bloqueada`.
- Production, billing, migrations, destructive operations, and new spending require explicit operator confirmation.

## Active Summary

| ID | Priority | State | Task | Primary user | RICE |
|---|---|---|---|---|---:|
| LH-001 | P0 | pendiente | Fix date hydration in `/admin` | Platform operator | 4.50 |
| LH-002 | P0 | pendiente | Fail E2E on browser console errors | All users | 4.00 |
| LH-003 | P1 | pendiente | Add safe production verification for an ordinary user | Platform operator | 4.25 |
| LH-005 | P2 | pendiente | Verify provider alerts and limits | Platform operator | 4.25 |
| LH-004 | P2 | pendiente | Update repository production-status documentation | Engineering team | 3.75 |
| LH-006 | P2 | pendiente | Remove the Playwright `allowedDevOrigins` warning | Engineering team | 3.50 |
| LH-007 | P3 | pendiente | Consolidate language handling in auth and onboarding | End users | 3.25 |
| LH-008 | P3 | pendiente | Define optional service-expiration automation | Platform operator | 2.75 |
```

The P2 summary intentionally orders `LH-005` before `LH-004` because RICE orders work within the same priority; IDs remain stable and are not renumbered.

- [ ] **Step 3: Add the detailed active sections**

Add P0 through P3 sections. Every task entry must contain these exact fields:

```markdown
### LH-NNN: Task title

- Priority: `P0|P1|P2|P3`
- State: `pendiente`
- Primary user: named persona
- RICE: `N.NN` with `reach / impact / confidence / effort`
- Why now: concrete current risk or user consequence
- Dependencies: explicit dependencies, or `None`
- Scope: one bounded deliverable
- Acceptance:
  - observable criterion
- Evidence required:
  - exact verification category
```

Use these exact scores and components:

| ID | Reach | Impact | Confidence | Effort | Score |
|---|---:|---:|---:|---:|---:|
| LH-001 | 4 | 4 | 5 | 5 | 4.50 |
| LH-002 | 4 | 4 | 4 | 4 | 4.00 |
| LH-003 | 3 | 5 | 5 | 4 | 4.25 |
| LH-004 | 2 | 3 | 5 | 5 | 3.75 |
| LH-005 | 3 | 5 | 5 | 4 | 4.25 |
| LH-006 | 2 | 2 | 5 | 5 | 3.50 |
| LH-007 | 4 | 2 | 4 | 3 | 3.25 |
| LH-008 | 3 | 3 | 3 | 2 | 2.75 |

Copy the approved scope and acceptance criteria for each ID from `docs/superpowers/specs/2026-08-19-development-task-tracking-design.md`, preserving these required outcomes:

- `LH-001`: deterministic date timezone, regression test, and zero `/admin` hydration errors.
- `LH-002`: capture `console.error` and `pageerror`, prove a synthetic error fails, and redact sensitive data.
- `LH-003`: dedicated non-personal identity, no global membership, no persisted tokens/cookies, and controlled cleanup/reuse.
- `LH-004`: synchronize `README.md`, `docs/STACK.md`, and `docs/production-activation.md` with verified reality only.
- `LH-005`: document alert, quota, and owner per provider without enabling billing or broadening credentials.
- `LH-006`: remove the harness warning without allowing development origins in production.
- `LH-007`: one language selector per screen, locale continuity, responsive layout, and clean console.
- `LH-008`: discovery must define users, metrics, temporal rules, alerts, audit, rollback, and operator approval before implementation.

- [ ] **Step 4: Add recent deployment history and maintenance rules**

Append:

```markdown
## Recently Completed

### LH-000: Role-aware post-login navigation

- Priority: `P0`
- State: `desplegada`
- Commit: `4f2f325`
- Result: `/auth/continue` sends active global administrators to `/admin`, ordinary authenticated users to `/onboarding`, and missing sessions to `/login`.
- Evidence: local tests/build/audit passed; GitHub Actions and Vercel completed successfully; production admin and anonymous boundaries were verified.

## Maintenance Rules

- Assign the next unused `LH-NNN` ID; never reuse archived IDs.
- Recalculate or justify RICE whenever priority changes.
- Record commands, results, commits, and deployment URLs as evidence; do not write unverified success claims.
- Split work before starting when one task spans independent subsystems.
- Keep ideas without acceptance criteria outside the active backlog until discovery is approved.
- Move older deployed entries to a compact archive when this file becomes difficult to scan.
```

- [ ] **Step 5: Validate content against the approved design**

Check each item manually and record any mismatch before continuing:

```text
[ ] All active IDs LH-001 through LH-008 appear once in the summary and once in detail.
[ ] Priority, state, persona, and RICE match the design spec.
[ ] Every active task has bounded scope, acceptance criteria, and evidence.
[ ] LH-000 records commit 4f2f325 as deployed.
[ ] Production/billing/migration confirmation rules are present.
[ ] No old spec is incorrectly reclassified as active work.
```

- [ ] **Step 6: Run document integrity checks**

Run:

```powershell
git diff --check -- tasks.md docs/superpowers/specs/2026-08-19-development-task-tracking-design.md docs/superpowers/plans/2026-08-19-development-task-tracking.md
git status --short
```

Expected: no whitespace errors; only the new tracking documents plus the pre-existing unrelated native-schema test are untracked. Do not stage or commit without explicit operator authorization.
