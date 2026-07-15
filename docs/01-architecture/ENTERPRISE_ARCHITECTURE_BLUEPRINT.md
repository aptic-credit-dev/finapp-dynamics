# Enterprise Architecture Blueprint

## Shape
Finapp Dynamics is a **modular monolith** (single deployable, strict module boundaries) on **PostgreSQL 16**,
multi-tenant with **RLS FORCE** isolation, event-driven via a **transactional outbox**, API-first under
`/api/v1/*`, and audit-first against a single registry. Modules own their tables and interact through contracts
and typed domain events — never by reaching into each other's tables.

## Layered architecture
```
Users | Mobile | Tenant Admins | Developers | Partners | Connectors | Extensions
                        │
Authentication · Identity Governance · Zero Trust · PAM            (6A + 6H)
                        │
Tenant · Entitlement · Commercial SaaS control plane              (6A + 6F)
                        │
──────────────────────────────────────────────────────────────
Enterprise platform (shared)
  Metadata/config · Workflow/BPM/Forms/Rules · Reporting/Analytics
  Integration Marketplace & Public APIs · Webhooks & Event Streaming
  Scheduler & Automation · Extension Framework · Mobile & Offline
  AI Platform & Executive Copilot · Security/Privacy/Compliance/GRC
──────────────────────────────────────────────────────────────
                        │
Operational · Legal · Finance · Recovery · AI modules
                        │
Observability · Backup · DR · Business Continuity                  (6G)
```

## Core principles
SaaS-first · modular · API-first · AI-assisted-but-human-controlled · audit-first · configurable workflows ·
security-by-design · data isolation · role-based access · explainability · scalability · integration-ready ·
enterprise reporting · adapted for African financial services.

## Tenancy & isolation
Every tenant-scoped table carries `tenant_id`, composite `(tenant_id, id)` uniqueness, composite foreign keys,
RLS enabled + FORCED, and a `tenant_isolation` policy bound to `current_setting('app.tenant_id')`. All access runs
inside tenant context. The only global tables are the tenancy control plane (m01), the audit spine (m03),
pre-authentication login attempts (m02), and global reference registries (e.g. m06 entity types).

## Shared-service spine
Auth + RBAC (m02), audit (m03), status/workflow/SLA/timeline + transactional outbox (m06), rules (m07),
notifications/escalation (m08), documents (m09). Every module consumes these through DI tokens
(`DB`, `AUDIT`, `AUTHZ`, `OUTBOX`) and contracts. There is exactly one implementation of each.

## Event model
Domain events are declared once in the contracts event union and published through the m06 outbox inside the
same transaction as the state change (exactly-once intent, idempotent consumers). 81 event families in the
reference baseline.

## Security posture
Deny-by-default Zero Trust layered over RBAC (an allow never grants a permission the caller lacks); server-side
DLP; no raw key storage (references only); time-bound privileged access; immutable published policies; maker-
checker + SoD on controlled actions; append-only tamper-evident audit.

## AI governance
A central AI gateway with provider abstraction, model + prompt registries, RAG/vector services, confidence
scoring, citations, human review, DLP, residency, and audit. AI never approves/posts/files/concludes and never
sends restricted data to unapproved providers.

## Deployment intent
One deployable for MVP with environment isolation (dev/test/UAT/staging/production/DR), horizontal scaling,
backups + PITR, observability (logs/metrics/traces with tenant + correlation context), and emergency
suspension/kill switches. Services are boundary-clean for later extraction.
