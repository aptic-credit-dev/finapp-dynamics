# Stage 2.5 — M09 Enterprise Document Management — Implementation Plan

Grounded in the m07/m08 pattern. Built on `feature/stage-2-5-m09-documents` from certified `30b69c2`.

## Sequence (as built)

1. **contracts** — `document.lifecycle` family (22 event types); wired into the `DomainEvent` union +
   `DOMAIN_EVENT_FAMILIES`; contracts smoke bumped (7→8 families).
2. **package skeleton + vocabularies** — `packages/m09-docs` (package.json, tsconfig, root + apps/api refs);
   27 `documents.*` permissions; 30 `DOC_*` audit codes.
3. **PURE domain** — limits + classification, content safety, lifecycles, doctype/retention specs, metadata,
   retention/disposition/legal-hold rules, relationships; hash util.
4. **storage + scan ports** — `DocumentStorage` + `InMemoryStorage`; `ContentScanner` + `DeterministicScanner`.
5. **migrations** — `0001_documents.sql` (10 tables, RLS FORCE, composite keys/FKs, one-active + idempotency +
   lease + append-only, permission seed) and `0002_grant_application_role.sql` (no DELETE; scan INSERT+SELECT).
6. **repository + emit + errors** — all SQL (optimistic-lock CAS, lease/unique-constraint claims, append-only
   inserts); `M09Emitter` (audit + m06 outbox).
7. **services** — Catalog (types + retention), Document (create/metadata/classification/upload/scan/activate/
   lifecycle/search/download), Access (grants/checkout/relationships), Records (legal hold/disposition); index.
8. **API** — `apps/api/src/documents` (views + 4 controllers + module binding Framework-Only storage/scan);
   wired into `AppModule`.
9. **registries + manifest** — permission/audit/event registries; naming-map `event_family_registered: true`;
   manifest m09 → implemented + `certification_2_5`; finalize `certification_2_4`.
10. **tests** — smoke (domain), db-spec (governance), services-db-spec (end-to-end + concurrency + SoD), api-spec.
11. **docs** — README, architecture/readiness/plan/completion, ADR-044…051.

## Design choices

- **10 tables** (module-registry reference baseline is 7; the enterprise scope — types, retention, versions,
  ACL, checkout, relationships, holds, disposition, scan — justifies 10; documented).
- Bytes live behind the storage port; PostgreSQL holds an opaque storage ref + metadata (ADR-044).
- Upload is a two-step server-verified flow (initiate → complete), rejecting any client-claimed hash/size that
  does not match the stored object.
- Disposition + checkout + escalation-style concurrency use unique constraints + optimistic locks + leases.
- Extraction/OCR and real e-signature are **deferred framework hooks** (documented), not implemented.

## Verification

Every gate actually executed; PostgreSQL 15.2 locally, PostgreSQL 16 in CI (authoritative). Counts recorded in
the completion report.
