# Stage 2.5 — M09 Enterprise Document Management — Architecture

**Module:** `m09-docs` · **Branch:** `feature/stage-2-5-m09-documents` · **Baseline:** certified Stage 2.4 main
`30b69c2` (PR #17 merge). **ADRs:** ADR-044…051.

## Purpose & boundary

One generic, multi-tenant **document & records management** service consumed by Cases, Legal, Finance and others
through events/contracts. It is **not** a document editor, collaborative word processor, enterprise search, AI
knowledge base, or external portal (see Exclusions). It consumes shared services via kernel tokens (`DB`,
`AUDIT`, `AUTHZ`, `OUTBOX`) and owns no shared service.

## Shape (mirrors m07/m08)

- **PURE domain** — content safety (filename traversal guard, media type, content hash, upload verification);
  document/version/spec/disposition state machines; typed metadata + type/retention spec validation; retention/
  legal-hold/disposition rules; relationship acyclicity; classification + downgrade.
- **Storage + scan ports** — `DocumentStorage` + `ContentScanner`, deterministic test doubles only; bytes in an
  object store, never PostgreSQL (ADR-044).
- **10 tables** — types + retention (immutable specs, one-active); document; immutable versions (one-active,
  committed-frozen); ACL grants; checkout (single-winner lease); relationships (acyclic); legal holds;
  disposition (evidence); scan results (append-only). All composite `(tenant_id,id)`, RLS FORCE, no-DELETE.
- **Services** — Catalog / Document / Access / Records, each permissioned + transactional, audit + outbox in the
  business tx via one `M09Emitter`.
- **API** `/api/v1/documents` — types, retention, documents, versions, upload initiate/complete, lifecycle,
  search, access grants, checkout, relationships, legal holds, disposition, download.

## Key decisions

| Concern | Decision | ADR |
|---|---|---|
| Storage | object store behind a port; bytes never in PG; opaque storage ref; no cloud/secrets | 044 |
| Versions/specs | immutable versions (one-active, committed-frozen); versioned immutable type/retention specs | 045 |
| Evidence | audit/events/scan carry ids/hashes/states only — never content/URLs/keys/AV payloads | 046 |
| Content safety | filename traversal guard, media allow-list, hard limits; no arbitrary paths/URLs | 047 |
| Access | document ACL supplements RBAC, never replaces it | 048 |
| Classification | ordered levels; downgrade needs platform authority + audit | 049 |
| Retention/hold | hold always blocks disposal; no auto-destroy; SoD approval; tombstone | 050 |
| Scan/sign | scan gate before release; scan/extraction/e-sign are Framework-Only ports | 051 |

## Integration

m06 workflow orchestrates document submission/approval gates through events/contracts; m07 rules consume typed
document facts (present/active/scan-clean/approved) — never raw content; m08 sends document notifications. A
notification/scan failure never mutates a committed version or a completed decision. `document.lifecycle` (22
types) flows through the single m06 outbox.
