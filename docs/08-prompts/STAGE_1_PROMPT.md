# Stage 1 Prompt — SaaS Foundation

Build the SaaS foundation in dependency order: m01 tenancy → m02 auth/RBAC → m03 audit → m06
status/workflow/SLA/timeline/outbox → m07 rules → m08 notify/escalation → m09 documents → m04 admin console.

Requirements:
- m01: tenants (authoritative, global) + subsidiary/department/branch hierarchy + provisioning steps. Global
  control-plane tables are non-FORCE; everything tenant-scoped is FORCE.
- m02: authentication (sessions, tokens, lockout, dormant detection, service accounts, break-glass seam), RBAC
  with a permission catalogue, SoD detection. Enforce server-side via `AUTHZ`.
- m03: single audit registry + append-only audit spine (partitioned logs + chain anchors). Unregistered codes
  fail CI.
- m06: status engine, configurable versioned workflow, SLA timers (business calendars), timeline (structured +
  free-text), and the transactional outbox + idempotency store.
- m07/m08/m09: rules, notifications/escalation, documents — all consumed via contracts.
- m04: admin console (tenant/subsidiary/department/branch/user/role/permission/workflow/rules/templates/branding/
  feature-flags).

Ship permissions + events + audit codes + tests for each. Prove tenant isolation and the audit spine with DB
specs. Run the full baseline + conformance. Update docs + manifest. Commit per module. Then request Stage 2.
