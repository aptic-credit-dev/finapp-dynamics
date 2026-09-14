# Production Incident Response Runbook

> Detection-to-recovery procedure for production incidents on the Aptic Dynamics platform (frozen candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`). Closes the incident-response half of gate **G7**. This document is
> planning-only: it names no appointees, marks no gate PASS, and authorises no production action. Every role below
> is a blank appointment/signature field to be filled by COO/Ops at commissioning.

## 1. Scope and preconditions

This runbook governs how a live production incident is detected, classified, escalated, and resolved once the
platform is commissioned. It is inert until the M42 human decision is recorded and Patrick has issued the explicit
production authorisation. It weakens no RBAC/RLS/SoD/audit/encryption/backup/SSH/network control.

Approved operational targets it defends (OQ#13):

- Availability ≥ 99.9%
- Latency p95 ≤ 200 ms, p99 ≤ 500 ms
- Error rate ≤ 0.5%
- Recovery: RTO ≤ 15 min, RPO ≤ 5 min

## 2. Severity levels

Classify at first triage; re-classify as understanding improves. When ambiguous, assume the **higher** severity
(fail-closed).

| Severity | Definition | Example triggers |
|---|---|---|
| SEV1 — Critical | Full outage, data-integrity loss, or security breach affecting all tenants. | Auth/RLS/SoD regression exposing cross-tenant data; audit hash-chain break; primary DB down with no standby; confirmed secret exposure; total loss of `GET /api/v1/health`. |
| SEV2 — Major | Severe degradation or single-tenant outage; SLO breach sustained. | Sustained p95 > 200 ms or error rate > 0.5% beyond burn window; replication lag beyond RPO; backup job failing repeatedly; one enabled Day-1 module unusable. |
| SEV3 — Minor | Partial/intermittent degradation with a workaround; no data risk. | Elevated latency within tolerance; a single non-critical alert flapping; a background job retrying but succeeding. |
| SEV4 — Low | Cosmetic or informational; no user-facing impact. | Noisy log line; a non-actionable warning; a monitoring self-test. |

## 3. Detection sources

- **Alerts** — SLO-burn, backup-failure, replication-lag, and auth-anomaly alerts from the monitoring stack
  (see `PRODUCTION_MONITORING_ALERTING_PLAN.md`). These are the primary detection path once wired.
- **Health** — `GET /api/v1/health` (liveness only, `stage:0`); container healthchecks. Note the known gap: there is
  **no DB-readiness probe**, so a healthy liveness response does not prove DB reachability — corroborate with DB
  metrics and the app-role connection check.
- **Logs** — centralized application + audit logs; correlation ids link a user action to its audit event.
- **Human report** — support intake (L1) or a stakeholder observation, routed via the escalation tree below.

## 4. Roles

All roles are blank appointments; a single person may hold more than one only where SoD is not thereby violated
(the person who executes a rollback must not be the sole approver of that rollback).

| Role | Responsibility | Appointee | Appointed (UTC) | Signature |
|---|---|---|---|---|
| Incident Commander (IC) | Owns the incident end to end; declares severity; authorises rollback decision. | | | |
| Communications Lead | Owns internal/external comms cadence and stakeholder updates. | | | |
| Operations Engineer | Executes diagnosis, mitigation, and (on IC authority) rollback commands. | | | |
| Rollback Authority | Approves execution of a rollback / restore (may be the IC if SoD permits). | | | |
| Scribe | Records timeline, decisions, and correlation ids for the post-incident review. | | | |

## 5. Response steps by severity

General loop for every incident: **Detect → Declare → Assemble → Diagnose → Mitigate → Recover → Verify →
Communicate → Review.**

### SEV1 — Critical

1. Declare SEV1; page IC and Ops Engineer immediately; open the incident channel and start the scribe log.
2. IC assesses whether a rollback trigger (§7) is met; if so, invoke the rollback-decision authority path.
3. Contain first: if a security/isolation regression is suspected, fail closed (restrict access) before
   investigating further.
4. Ops Engineer executes mitigation or rollback per `PRODUCTION_CUTOVER_RUNBOOK.md` §13 under IC authorisation.
5. Comms Lead issues the initial stakeholder notice within the first cadence window (§8).
6. Verify recovery against health, SLO metrics, and audit-chain integrity before standing down.

### SEV2 — Major

1. Declare SEV2; notify IC and Ops Engineer; open the incident channel.
2. Diagnose against the SLO dashboards; determine whether degradation is trending toward a rollback trigger.
3. Mitigate in place where possible (e.g. shed load at the reverse proxy, address replication lag); escalate to
   SEV1 if a trigger is crossed.
4. Comms Lead issues updates on the SEV2 cadence (§8).
5. Verify and stand down when metrics are back inside SLO for a sustained window.

### SEV3 — Minor

1. Log the incident; assign an Ops Engineer; no paging required.
2. Apply the known workaround; monitor for escalation.
3. Communicate on the SEV3 cadence; close with a lightweight note.

### SEV4 — Low

1. Record as a ticket; batch into normal operational work; no incident channel required.

## 6. Escalation timeline

Times are targets from first detection; the IC may compress them for higher blast radius.

| Severity | Acknowledge | Assemble responders | First stakeholder update | Escalate if unresolved |
|---|---|---|---|---|
| SEV1 | ≤ 5 min | ≤ 15 min | ≤ 15 min | ≤ 30 min → invoke rollback authority / exec escalation |
| SEV2 | ≤ 15 min | ≤ 30 min | ≤ 30 min | ≤ 2 h → consider promotion to SEV1 |
| SEV3 | ≤ 1 business h | as needed | ≤ 4 business h | ≤ 1 business day |
| SEV4 | next business day | n/a | n/a | n/a |

## 7. Rollback trigger thresholds

Any one of the following, observed in production, is a rollback trigger. The **Rollback Authority** (not automation,
not AI) decides; the decision and rationale are recorded by the scribe.

- Failed liveness/health or failed readiness (DB unreachable via the non-superuser app role).
- Auth, RLS, or SoD regression (any cross-tenant exposure, any maker-checker bypass).
- Error-rate breach vs SLO (> 0.5%) or p95 breach (> 200 ms) sustained beyond the burn window.
- Audit hash-chain break or gap in audit continuity.
- Backup failure or replication lag beyond RPO (> 5 min).

Rollback mechanics (per `PRODUCTION_CUTOVER_RUNBOOK.md` §13 and `PRODUCTION_INFRASTRUCTURE_READINESS.md` §D):
clone → `git checkout DEPLOYED_SHA.prev` → rsync → `docker compose … up -d --build`. **App-only rollback is safe
only when the release applied no schema migration**; a schema-migrating release must first restore the pre-cutover
snapshot (Cutover Runbook Step 2). Verify health after rollback and communicate.

## 8. Communications cadence

| Severity | Update interval during incident | Channels |
|---|---|---|
| SEV1 | every 30 min until mitigated | internal incident channel + stakeholder notice |
| SEV2 | every 60 min until mitigated | internal incident channel + stakeholder notice |
| SEV3 | at open and at close | ticket + internal channel |
| SEV4 | at close only | ticket |

Comms Lead owns message accuracy; no message asserts a fix until verified. Templates for the go-live, user, and
incident/rollback notices live in `PRODUCTION_DAY1_OPERATIONS.md`.

## 9. Post-incident review (PIR)

Run a blameless PIR for every SEV1 and SEV2 within five business days of stand-down.

- Reconstruct the timeline from the scribe log and correlation ids.
- Identify root cause and contributing factors (technical and process).
- Confirm audit-chain integrity across the incident window.
- Record corrective actions with owners and due dates; track to closure.
- Capture PIR sign-off below (blank until executed).

| PIR field | Value |
|---|---|
| Incident id / date (UTC) | |
| Severity | |
| Root cause | |
| Corrective actions (owner · due) | |
| Reviewed by (appointee) | |
| Review date (UTC) | |
| Signature | |

## Governance

Governance: STAGING/PLANNING only; M42 NO_GO; Stage-7 unchanged; no production action.
