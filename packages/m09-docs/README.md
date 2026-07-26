# m09-docs — Enterprise document & records management (Stage 2.5)

Generic, multi-tenant **document and records** infrastructure: controlled records, immutable versions,
metadata, access, retention, legal hold, disposition, and evidence — reusable by Cases, Legal, Finance and any
module that manages documents, none embedding storage logic. **Not** a document editor, collaborative suite,
enterprise search, or portal.

## Layers

- **PURE domain** (`src/domain/`): content safety (filename normalization + strict path-traversal guard, media
  type + content-hash validation, upload verification); the document / version / spec / disposition state
  machines; typed metadata + document-type + retention-policy validation; retention / legal-hold / disposition
  rules (hold always blocks disposal); relationship acyclicity; classification + downgrade rules.
- **Storage + scan ports** (`storage.ts`, `scan.ts`): `DocumentStorage` (put/head/read/purge) and
  `ContentScanner` with **deterministic test doubles** — no cloud provider, no antivirus, no secrets. Bytes never
  touch PostgreSQL (ADR-044).
- **Persistence** (`migrations/0001_documents.sql`, 10 tables, all RLS ENABLE+FORCE + `tenant_isolation`,
  composite `(tenant_id,id)` keys + composite FKs): `document_type`, `retention_policy` (immutable specs,
  one-active), `document`, `document_version` (immutable, one-active, committed-frozen), `document_access_grant`,
  `document_checkout` (single-winner lease), `document_relationship` (acyclic), `document_legal_hold`,
  `document_disposition`, `document_scan_result` (append-only). `0002`: NO DELETE anywhere; scan evidence
  INSERT+SELECT only.
- **Services**: `CatalogService` (types + retention lifecycle), `DocumentService` (create, metadata,
  classification, server-verified upload initiate→complete, scan-gated activate, lifecycle, search, download),
  `AccessService` (ACL grants, checkout, relationships), `RecordsService` (legal hold, disposition with
  maker≠checker approval + tombstone). One `M09Emitter` writes audit (m03) + events on the **one outbox m06
  owns**.
- **API** (`/api/v1/documents`): 30 audited mutating routes + 12 reads. Every mutating route is an audited
  `@Endpoint` with a permission enforced server-side (default deny).

## Governance

Tenant isolation (RLS FORCE on all 10 tables), default-deny authorization (27 `documents.*` permissions,
seeded), audit via the m03 port (30 `DOC_*` codes, no duplicate audit table), the single m06 outbox for
`document.lifecycle` (22 event types), idempotent creation/upload/disposition, single-winner checkout,
immutable versions, hold-blocks-disposal, disposition SoD + tombstone, classification downgrade control, and
sensitive-data minimization (evidence/events carry ids/hashes/states, never content/URLs/keys). ADR-044…051.

## Providers (Framework Only)

Storage, scan, extraction, and e-signature are **ports** with deterministic test doubles — m09 ships no cloud
storage, no antivirus, no OCR, and no e-signature, and commits no secrets. Real adapters are a future
responsibility. Approval orchestration delegates to m06 workflow.

## Tests

`test/m09-docs.smoke.ts` (PURE domain), `test/m09-docs.db-spec.ts` (RLS/grants/constraints/isolation),
`test/m09-services.db-spec.ts` (end-to-end incl. upload verification, scan gate, SoD, tombstone, concurrency),
and `apps/api/test/api-documents.db-spec.ts` (HTTP end-to-end). Smoke: `npm run test:smoke`; DB lane:
`npm run test:db` against a real PostgreSQL (CI is PostgreSQL 16, authoritative).
