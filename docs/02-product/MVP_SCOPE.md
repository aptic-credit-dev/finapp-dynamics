# MVP Scope — Must / Should / Later

## Must-have (build first)
| Capability | Module | Notes |
|---|---|---|
| Tenancy + hierarchy | m01 | subsidiary/department/branch |
| Auth + RBAC + permissions | m02 | server-side enforcement |
| Audit spine | m03 | append-only, registered codes |
| Status/workflow/SLA/timeline/outbox | m06 | shared services |
| Notifications + escalation | m08 | email/in-app for MVP |
| Documents | m09 | classified, linked |
| Feedback Management | m12 | capture→escalate→review→close |
| Case Management | m13 | assign→activities→SLA→close |
| Bank + GL Reconciliation | m15/m15a/m20 | ingest→match→exceptions→report |
| Journal (draft-only) | m21/m22 | recommend→draft→approve (no post) |
| Admin console | m04 | tenant/user/role/config |
| Basic reporting | m10 | role dashboards |

## Should-have (fast follow after MVP)
Legal Matter management (read-write), litigation/court tracking, recovery, legal documents + knowledge, governed
AI beyond summaries, richer analytics, WhatsApp notifications, more connectors (sandbox → certified).

## Later (Phase 2/3 / commercial)
Journal posting to core systems, payments, legal filing automation, full public APIs + developer portal,
extension marketplace, commercial SaaS billing + external tenants, mobile offline write paths for controlled
actions, advanced AI (autonomous-with-guardrails workflows), Phase 7 verticals.

## Discipline
Design for the full capability; implement the minimal safe version first. Everything high-risk is deferred and
guarded by feature flags, approvals, and the certification gate.
