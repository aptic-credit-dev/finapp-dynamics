# Shared-Service Ownership

Exactly one authoritative implementation of each shared service. Consume via DI token/contract; never duplicate.

| Shared service | Owner module | Consumed via | Notes |
|---|---|---|---|
| Tenant resolution / tenancy | m01-tenant | tenant context, composite FKs | 1 tenants table; global control plane |
| Authentication | m02-identity | auth guards | login_attempts is pre-auth (global) |
| Authorization / RBAC / permissions | m02-identity | `AUTHZ` token | 1 permission catalogue seed |
| Audit | m03-audit | `AUDIT` token | 1 code registry; append-only; unregistered codes fail CI |
| Status engine | m06-workflow | contract | state machines per entity |
| Workflow / BPM | m06-workflow | contract | configurable, versioned |
| SLA / timers | m06-workflow | contract | business calendars |
| Timeline / activity | m06-workflow | contract | structured + free-text |
| Transactional outbox | m06-workflow | `OUTBOX` token | **the only** event-delivery path |
| Rules engine | m07-rules | contract | versioned, auditable |
| Notifications | m08-notify | contract | email/SMS/WhatsApp-ready/in-app |
| Escalation | m08-notify | contract | triggers on SLA/status |
| Documents | m09-docs | contract | classified, linked, versioned |
| Idempotency | m06-workflow | idempotency store | high-risk actions |
| Platform metadata | m30-platform | contract | governed platform-metadata catalog (Stage 6A) |
| Platform configuration | m30-platform | contract | typed config definitions + values + history; secret-bearing settings hold a secret reference only |
| Feature flags | m30-platform | contract | ONE feature-flag engine (definitions/assignments/evaluation); a flag never bypasses RBAC; m04-admin CONSUMES it (GAP-5, ADR-115) |
| Secrets | platform (m30) | secret references | m30 owns the secret-reference SEAM only (opaque secretref:, no raw/encrypted secret VALUE); real secret/key management = m41-security (ADR-116) |
| Design-time authoring (Workflow/BPM/Rules/Forms Studio) | m31-studio | contract | DESIGN-TIME only (author/validate/version/review/publish/bind); the runtime engines stay canonical — m31 compiles/binds designs to m06 workflow + m07 rules, never a second engine, no runtime execution (Stage 6B, ADR-117) |
| Reusable forms / form schemas | m31-studio | contract | canonical owner of reusable DECLARATIVE form/schema DEFINITIONS (typed fields, versioned, published-immutable, no executable code); FORM DEFINITION ≠ BUSINESS RECORD — submitted records stay domain-owned, m12 questionnaires stay m12 (Stage 6B, ADR-117) |
| Entitlements / quotas | m39-saas | contract | plan → capability → flag order |
| Usage metering / billing | m39-saas | contract | idempotent usage; immutable invoices |
| Reporting / analytics | m10-report / m32-analytics | contract | semantic datasets, RLS, masking |
| AI gateway | m24-ai-foundation | contract | provider abstraction, registries |
| Security control plane | m41-security | contract | posture over RBAC; never replaces it |

## Verification (reference baseline)
0 outbox implementations outside m06 · 1 tenants table (m01) · 1 audit registry (m03). Any new module must be
checked against this table before it is allowed to ship.
