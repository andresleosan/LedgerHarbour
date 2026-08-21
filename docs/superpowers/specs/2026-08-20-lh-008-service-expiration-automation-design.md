# LH-008: Service Expiration Automation Discovery

## Status

Approved discovery direction: compare informational dates, notifications, and
automatic suspension. Recommend notifications first. This document does not
authorize implementation, production scheduling, customer suspension, billing
changes, provider selection, or new spending.

## Problem

`serviceExpiresAt` is currently an informational business field. It is stored as
a timezone-aware timestamp and is set when a platform administrator approves a
business. The platform UI displays the date, but there is no defined operational
process for noticing upcoming expirations or following up after a service has
expired.

The primary users are platform operators and business administrators. The
desired outcome is to reduce manual expiration follow-up while avoiding false
suspensions of valid customers.

## Goals

- Compare the three viable product behaviors before implementation.
- Define the operational rules needed for any notification or automation.
- Recommend a reversible first phase that measurably reduces manual work.
- Define safety gates for any later suspension behavior.
- Reassess the LH-008 RICE score using discovery evidence.

## Non-goals

- No scheduler, worker, cron route, notification provider, or new dependency.
- No automatic suspension or change to business lifecycle behavior.
- No production database migration, deployment, billing change, or provider access.
- No credentials, customer data export, or external-service verification.

## Alternatives

### A. Keep the date informational

The platform continues displaying `serviceExpiresAt` and operators follow up
manually.

- Lowest implementation and operational risk.
- Does not materially reduce manual work.
- Preserves the current ambiguity around timezone, grace periods, and ownership
  of follow-up.

### B. Add expiration notifications (recommended)

A future read-only evaluation identifies businesses approaching or past their
expiration and sends deduplicated notifications to the platform operator and
the affected business administrators. The first implementation should support
an observation or dry-run mode before delivery is enabled.

- Directly targets the manual-follow-up problem.
- Does not revoke access or mutate lifecycle state.
- Allows notification timing and false-positive rates to be measured first.
- Requires an approved delivery channel, delivery failure handling, and audit
  visibility before implementation.

### C. Automatically suspend expired services

A future scheduled action changes eligible businesses to `suspended` after the
expiration and grace period.

- Highest potential reduction in manual work.
- Highest risk: timezone mistakes, stale dates, renewals racing the job,
  provider failures, and incorrect customer impact.
- Requires idempotency, concurrency control, recovery tooling, audit events,
  manual override, and explicit operator approval.

## Recommendation

Choose alternative B as the next product phase, preceded by a dry-run/observation
period. Do not implement alternative C in LH-008. Automatic suspension can be
reconsidered only after notification metrics demonstrate that the date and
ownership rules are reliable and the operator explicitly approves a separate
implementation task.

The recommended sequence is:

1. Discovery and dry-run contract: classify upcoming, grace-period, and expired
   records without changing data.
2. Notification phase: deliver deduplicated reminders and record outcomes.
3. Review phase: measure manual hours saved, delivery reliability, false
   positives, and remediation time.
4. Separate decision: approve or reject gated suspension based on evidence.

## Required Rules Before Implementation

### Time and eligibility

- Define the business timezone or a canonical timezone for comparison.
- Define whether `serviceExpiresAt` represents the start or end of the final
  service day. The current approval UI accepts a date and converts it to an end-
  of-day UTC timestamp; this behavior must be confirmed before automation.
- Define notification windows before expiration and the grace period after it.
- Define eligible statuses and exclude pending, rejected, already suspended,
  and businesses without an expiration date unless product discovery says
  otherwise.
- Define how renewal or expiration-date edits invalidate pending notifications.

### Notifications

- Identify the platform operator and business administrators who receive each
  notification.
- Select an approved delivery channel without committing to a provider in this
  discovery.
- Define message content, links, locale, rate limits, and opt-out or override
  behavior where applicable.
- Use a stable deduplication key based on business, expiration event, window,
  and current expiration value.
- Define retry limits, backoff, dead-letter or failure visibility, and the
  behavior when the delivery provider is unavailable.

### Audit and recovery

- Record evaluation, notification attempt, delivery result, and operator action
  as auditable events without storing sensitive message content unnecessarily.
- Define who can acknowledge, resend, suppress, or override an alert.
- For any future suspension, require a separate audit event with before/after
  state, reason, actor or job identity, expiration value, and correlation ID.
- Define rollback as restoring the prior lifecycle state only through an
  authorized, audited operation; no automatic unsuspension is implied.

## Measurement

Primary outcome:

- Reduction in operator and business-administrator hours spent manually tracking
  service expiration.

Secondary measures:

- Percentage of eligible expirations identified before the due window.
- Notification delivery and retry success rates.
- Duplicate-notification rate.
- False-positive or stale-alert rate after renewal or date correction.
- Median time from expiration alert to operator resolution.
- Number of manual overrides or support incidents.

Discovery must establish a baseline or a low-cost measurement method before any
automated action is proposed.

## Security and Operational Review

- Do not expose business data or customer details in logs, URLs, or diagnostic
  output beyond the minimum required for an audit event.
- Treat notification recipients and message content as sensitive operational
  data.
- Do not bypass existing platform authorization for viewing or acting on a
  business.
- Rate-limit notification delivery and make retries idempotent.
- Never let a provider outage, duplicate job, clock skew, or partial transaction
  suspend a business accidentally.
- A scheduled mutation requires a transaction or equivalent compare-and-set
  lifecycle guard, plus an operator-visible recovery path.

## Discovery Deliverable

The next LH-008 task may produce only a product brief and, if needed, an
architecture/security review. It must record the alternatives, selected
recommendation, timezone/grace/notification/idempotency/audit/rollback rules,
failure modes, measurement baseline, simplified RICE reassessment, and explicit
operator approval required for any implementation. It must leave production
behavior unchanged.

## Acceptance

- The affected users and measurable manual-work outcome are explicit.
- All three alternatives and their trade-offs are documented.
- Notifications are recommended before suspension, with a dry-run gate.
- Timezone, grace period, notification timing, recipients, retries,
  idempotency, audit, rollback, and provider-failure behavior are specified.
- The proposal identifies unresolved decisions without hiding them as defaults.
- No scheduler, suspension, migration, deployment, billing action, or external
  provider request is performed during discovery.
- The operator approves the recommendation before an implementation plan exists.
