# Production Support & Operational Handover

> Support model, on-call roster, escalation authority, and operational-handover checklist for the Aptic Dynamics
> platform (frozen candidate `b26d4675fafc9b55b616f41319f191e9f6fb6269`). Closes gate **G11**. Every appointee,
> authority, and sign-off below is a blank field to be filled by COO/Ops at commissioning; this document authorises
> no production action.

## 1. Scope

Defines who supports the platform in production, the on-call coverage, the escalation and authority chains, and the
knowledge/access that must transfer from engineering to operations before go-live. Support targets defend the
approved SLOs (OQ#13): availability ≥ 99.9%, p95 ≤ 200 ms, p99 ≤ 500 ms, error rate ≤ 0.5%, RTO ≤ 15 min,
RPO ≤ 5 min.

## 2. Support roster and on-call coverage

Blank appointees. A person may hold multiple rows only where Segregation of Duties is preserved (the identity that
executes a controlled action must not be the sole approver of it).

| Tier | Function | Coverage window | Appointee | Contact | Signature |
|---|---|---|---|---|---|
| L1 | Frontline intake / triage | business hours | | | |
| L2 | Operations engineering | on-call 24×7 rotation | | | |
| L3 | Platform / deep engineering | on-call escalation | | | |
| On-call primary | Pager holder | rotating (weekly) | | | |
| On-call secondary | Backup pager | rotating (weekly) | | | |

## 3. Escalation tree

| Level | Handles | Escalates to | Appointee | Signature |
|---|---|---|---|---|
| L1 | Intake, known workarounds, SEV3/SEV4 | L2 | | |
| L2 | Diagnosis, mitigation, SEV2 | L3 | | |
| L3 | Deep engineering, root cause | Incident Commander | | |
| Incident Commander | SEV1 ownership, rollback-decision path | Exec escalation | | |

Severity definitions and the incident loop live in `PRODUCTION_INCIDENT_RESPONSE_RUNBOOK.md`.

## 4. Deployment and rollback authority

Authority is human and explicit; neither AI nor automation holds it. Deployment proceeds only on Patrick's explicit
"APPROVED — EXECUTE PRODUCTION CUTOVER" and a recorded M42 GO/CONDITIONAL_GO.

| Authority | Held by (appointee) | Backup | Signature | Date (UTC) |
|---|---|---|---|---|
| Deployment authority (authorises cutover execution) | | | | |
| Rollback authority (authorises rollback/restore) | | | | |
| M42 production-decision authority | | | | |

## 5. Operational handover checklist

Engineering → Operations. Each item is verified and signed before go-live; blank until executed.

| # | Area | Item to hand over | Verified | Owner (appointee) | Date (UTC) | Signature |
|---|---|---|---|---|---|---|
| 1 | Access | Host SSH (pubkey-only), non-root `deploy` user, sudo scope | | | | |
| 2 | Access | Reverse-proxy / TLS admin access | | | | |
| 3 | Runbooks | Cutover, incident-response, monitoring, Day-1 ops runbooks located and understood | | | | |
| 4 | Monitoring | Dashboards, alert routes, on-call paging verified (see monitoring plan §7) | | | | |
| 5 | Backups | Backup schedule, off-server destination, `pg_verifybackup`, restore procedure | | | | |
| 6 | Secrets custody | OpenBao access model; Shamir custody (5/3) holders identified; no secret values transferred in the clear | | | | |
| 7 | DR | Standby/failover procedure; RTO/RPO targets; restore/failback rehearsal reference | | | | |
| 8 | On-call | Rotation, contacts, escalation tree, coverage windows confirmed | | | | |
| 9 | Deploy mechanics | SHA-pinned deploy, `DEPLOYED_SHA`/`.prev` markers, migration dry-run | | | | |
| 10 | Audit | Audit-chain integrity check procedure; correlation-id tracing | | | | |

## 6. Knowledge-transfer sign-off

Handover is complete only when both parties sign. Blank until executed.

| Party | Name (appointee) | Role | Date (UTC) | Signature |
|---|---|---|---|---|
| Handing over (Engineering) | | | | |
| Receiving (Operations) | | | | |
| Accepting authority (COO/Ops) | | | | |

## Governance

Governance: STAGING/PLANNING only; M42 NO_GO; Stage-7 unchanged; no production action.
