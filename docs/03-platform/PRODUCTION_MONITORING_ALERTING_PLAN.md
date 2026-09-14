# Production Monitoring & Alerting Plan

> Vendor-neutral observability and alerting design for the Aptic Dynamics platform (frozen candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`). Closes the monitoring half of gate **G7**. This is a plan: the stack
> is **NOT YET WIRED**, no alert has fired on a production host, and this document authorises no production action.

## 1. Scope

Defines what to monitor, a portable stack to monitor it with, the alert rules mapped to the approved SLOs, alert
routing/on-call escalation, and the test-alert verification checklist to be executed on the production host at
commissioning (Contabo Runbook §6, Cutover Runbook Step 11). It changes no application code and adds no in-app
service; all additions described here are host/proxy/observability-tier artefacts.

Approved SLOs / recovery targets it measures against (OQ#13):

- Availability ≥ 99.9%
- Latency p95 ≤ 200 ms, p99 ≤ 500 ms
- Error rate ≤ 0.5%
- RTO ≤ 15 min, RPO ≤ 5 min

## 2. What to monitor

| Signal | Source | Why it matters |
|---|---|---|
| App liveness | `GET /api/v1/health` (liveness only, `stage:0`) + container healthchecks | Detects process/container failure. See §6 readiness gap. |
| DB health | PostgreSQL 16 metrics; connectivity via the non-superuser app role | Liveness does not touch the DB; this is the only proof the DB is reachable. |
| Replication lag | standby/WAL replication metrics | RPO ≤ 5 min depends on lag staying bounded. |
| Backup success | backup-job exit status + `pg_verifybackup` result | A silent backup failure defeats the rollback restore point. |
| Auth anomalies | application + audit logs (lockouts, throttles, failed-login bursts) | Early signal of credential attack or misconfiguration. |
| SLO burn | request latency + error-rate metrics at proxy and app | Directly measures p95/p99/error-rate/availability SLOs. |
| Resource saturation | host CPU, memory, disk, file descriptors, connection pool | Saturation precedes latency and error breaches. |

## 3. Proposed portable stack (vendor-neutral)

No vendor lock-in is required (Contabo Runbook §6/§8). The reference design is portable to any provider:

- **Logs** — container stdout/stderr and audit logs shipped to a log aggregator (e.g. a self-hosted log store).
- **Metrics** — Prometheus-style scrape of host, container, and DB exporters.
- **Alerting** — an alertmanager-style router evaluating the rules in §4 and dispatching to the routes in §5.
- **Dashboards** — SLO dashboards (latency percentiles, error rate, availability, saturation) for triage.

All components run on the observability tier, isolated from the app, and are replaceable without touching
application code.

## 4. Alert rules mapped to the approved SLOs

Thresholds are proposals for COO/Ops acceptance; burn windows are indicative and to be tuned on the production host.

| Alert | Condition | Mapped SLO / target | Severity |
|---|---|---|---|
| Availability drop | successful-probe ratio < 99.9% over rolling window | availability ≥ 99.9% | SEV1 |
| Latency p95 breach | p95 > 200 ms sustained over burn window | p95 ≤ 200 ms | SEV2 → SEV1 if worsening |
| Latency p99 breach | p99 > 500 ms sustained over burn window | p99 ≤ 500 ms | SEV2 |
| Error-rate breach | 5xx / total > 0.5% over burn window | error rate ≤ 0.5% | SEV2 → SEV1 if worsening |
| Liveness failure | `GET /api/v1/health` non-200 or container unhealthy | availability | SEV1 |
| DB unreachable | app-role connection check fails | availability / integrity | SEV1 |
| Replication lag | lag > 5 min (RPO budget) | RPO ≤ 5 min | SEV2 → SEV1 at 2× |
| Backup failure | backup job non-zero exit or verify failure | rollback readiness | SEV2 |
| Auth anomaly | failed-login / lockout burst beyond baseline | security | SEV2 (SEV1 if breach suspected) |
| Resource saturation | CPU/mem/disk/pool beyond high-watermark | leading indicator | SEV3 → SEV2 |

Alerts that map to a rollback trigger (§7 of `PRODUCTION_INCIDENT_RESPONSE_RUNBOOK.md`) — liveness/DB failure,
auth/RLS/SoD regression, error-rate/p95 breach, audit-chain break, backup/replication failure — must page the
incident commander path, not just log.

## 5. Alert routes and on-call escalation

Routes and appointees are blank until COO/Ops assigns them.

| Alert class | Primary route | Secondary route | Escalates to | Appointee |
|---|---|---|---|---|
| SEV1 (page) | on-call Ops Engineer | Incident Commander | exec escalation | |
| SEV2 (page) | on-call Ops Engineer | Incident Commander | — | |
| SEV3 (notify) | ops channel | on-call (business hours) | — | |
| SEV4 (log) | ticket queue | — | — | |

On-call rotation and coverage are defined in `PRODUCTION_SUPPORT_AND_HANDOVER.md`.

## 6. Known gaps and recommendations

- **Liveness-only health.** `GET /api/v1/health` does not touch the database. Recommend adding a **DB-readiness
  probe** (app-role connectivity + FORCE-RLS assertion) so orchestration/LB readiness gating and the DB-unreachable
  alert have a first-class signal rather than inference from DB metrics.
- **Security headers.** The API sets no HSTS, no CSP, and no helmet; staging nginx sets only
  X-Frame-Options / X-Content-Type-Options / Referrer-Policy. Recommend the production **reverse proxy** add
  **HSTS and CSP** at 443 termination (Infrastructure Readiness §C).
- **Rate limiting.** Only auth-attempt lockout/throttle exists in-app; there is **no generic HTTP rate limiter**.
  Recommend a **rate limiter at the reverse proxy** to protect against volumetric abuse.

These recommendations are advisory and belong to the operator/commissioning scope; nothing here modifies the
application.

## 7. Test-alert verification checklist (to-be-executed on the prod host — NOT YET WIRED)

Execute at commissioning after the stack is stood up; record result + UTC timestamp; COO/Ops accepts (Tier-2).
Status of every item below is **to-be-executed**.

| # | Test | Expected result | Status | Result / UTC | Verified by (appointee) |
|---|---|---|---|---|---|
| 1 | Fire a synthetic SLO-burn alert | routes to on-call, pages IC path | NOT YET WIRED | | |
| 2 | Simulate a backup-job failure | backup-failure alert fires and routes | NOT YET WIRED | | |
| 3 | Induce replication lag > 5 min (test) | replication-lag alert fires | NOT YET WIRED | | |
| 4 | Trigger an auth-anomaly burst (test) | auth-anomaly alert fires | NOT YET WIRED | | |
| 5 | Stop the API container | liveness-failure alert fires | NOT YET WIRED | | |
| 6 | Block DB connectivity (test) | DB-unreachable alert fires | NOT YET WIRED | | |
| 7 | Confirm logs + metrics flowing to aggregator | dashboards populate | NOT YET WIRED | | |
| 8 | Confirm alert resolution/clear path | alert auto-resolves on recovery | NOT YET WIRED | | |

## Governance

Governance: STAGING/PLANNING only; M42 NO_GO; Stage-7 unchanged; no production action.
