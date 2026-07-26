# Stage 2.5 — M09 Enterprise Document Management — Completion Report

**Module:** `m09-docs` · **Branch:** `feature/stage-2-5-m09-documents` · **Baseline:** certified Stage 2.4 main
`30b69c2534f7ce224d278c73b3872019f5472ac9` (PR #17 merge, verified). **Status:** implemented on branch;
implementation PR open, **not merged** (awaiting review + post-merge certification).

Status legend: **implemented** = code on the branch · **tested locally** = green on the local PostgreSQL 15.2
lane · **CI-verified** = green on the authoritative PostgreSQL 16 CI lane · **not yet merged** · **deferred** =
documented, out of MVP scope.

## What was built

A generic, multi-tenant **document & records management** service — reusable by Cases, Legal, Finance and others
through events/contracts. **Not** an editor, collaborative suite, enterprise search, or portal.

- **PURE domain** (`src/domain/`): content safety (filename normalization + strict path-traversal/control-char
  guard, media-type + content-hash validation, server-side upload verification); the document / version / spec /
  disposition state machines; typed metadata + document-type + retention-policy validation; retention /
  legal-hold / disposition rules (an active hold ALWAYS blocks disposal); relationship acyclicity; classification
  + downgrade rules.
- **Storage + scan ports** (`storage.ts`, `scan.ts`): `DocumentStorage` (put/head/read/purge) + `ContentScanner`,
  **deterministic test doubles only** — no cloud provider, no antivirus, no secrets. Bytes never touch
  PostgreSQL (ADR-044).
- **Persistence** (`0001_documents.sql`, **10 tables**, all RLS ENABLE+FORCE + `tenant_isolation`, composite
  `(tenant_id,id)` keys + composite FKs): `document_type`, `retention_policy` (immutable specs, one-active),
  `document`, `document_version` (immutable, one-active, committed-frozen), `document_access_grant`,
  `document_checkout` (single-winner lease), `document_relationship` (acyclic), `document_legal_hold`,
  `document_disposition`, `document_scan_result` (append-only). `0002`: **NO DELETE anywhere**; scan evidence
  INSERT+SELECT only.
- **Services**: `CatalogService`, `DocumentService`, `AccessService`, `RecordsService`. One `M09Emitter` writes
  audit (m03) + events on the **one outbox m06 owns**, in the business tx.
- **API** (`/api/v1/documents`, **30 audited mutating routes + 12 reads**): types, retention, documents,
  versions, upload initiate/complete, lifecycle, search, access grants, checkout, relationships, legal holds,
  disposition, download. Every mutating route declares a permission (default deny).

## Scope

| Fact | Value |
|---|---|
| Source files changed vs Stage 2.4 baseline (excl. build output) | **49** (+6240 / −12); `packages/m09-docs` ~34, `apps/api/src/documents` 7 |
| Migrations | **2** (`0001_documents.sql`, `0002_grant_application_role.sql`); 18 total in the repo, m09 last |
| Tables created | **10** |
| Permissions added | **27** (`documents.*`, privileged: type/retention manage, access grant/revoke, checkout force-release, legal-hold manage, disposition approve/execute, scan override, platform administer) — seeded |
| Audit codes added | **30** (`DOC_*`); `registered_code_count` 148 → **178** |
| Events added | `document.lifecycle` family, **22** event types; in contracts union (7 → **8** families) |
| API endpoints | **30** mutating + **12** reads |
| ADRs | ADR-044…051 |

## Governance honoured

| Guarantee | How |
|---|---|
| Tenant isolation | RLS ENABLE+FORCE + `tenant_isolation` on all **10** tables; asserted through the non-owner app role. |
| Authorization | Default-deny; every mutation `authz.require`s its 3-segment permission; a header cannot grant authority (proven over HTTP). Document ACLs supplement RBAC (ADR-048). |
| Immutability | Committed version content frozen; one ACTIVE version per document; published type/retention specs frozen with content_hash; a committed version requires a content hash + byte size (CHECK). |
| Storage | Bytes in an object store behind a port; PostgreSQL holds an opaque storage ref only; storage ref redacted from API responses (ADR-044/046). |
| Upload integrity | Server verifies the object's ACTUAL hash + size against the claim; a mismatch is rejected (no completion forgery). |
| Content safety | Filename traversal/control/reserved-char guard; media allow-list; hard limits; no arbitrary paths/URLs (ADR-047). |
| Classification | Ordered levels; a downgrade requires platform authority + audit (ADR-049). |
| Scan gate | A version is not activatable/downloadable until scanning is `clean`/`bypassed` (ADR-051). |
| Retention/hold/disposition | Active hold ALWAYS blocks disposal; no auto-destroy; disposal = request → SoD approval (requester ≠ approver) → execute with tombstone (ADR-050). |
| Append-only evidence | Scan evidence INSERT+SELECT only; NO DELETE on any m09 table (tombstone remains). |
| Idempotency | DB-enforced on document creation, upload initiation, and disposition; conflict → 409. |
| Concurrency | Optimistic locks + unique constraints + a single-winner checkout lease. |
| Single outbox | m09 owns no outbox; publishes `document.lifecycle` through m06's `WorkflowOutbox` (ADR-004/044). |
| Sensitive-data minimisation | Audit + events + scan evidence carry ids/hashes/states only — never content, extracted text, signed URLs, credentials, or keys (ADR-046). |

## Verification (authoritative gate)

- **Build:** `tsc --build` clean. **Lint:** 0 errors (pre-existing non-blocking warnings only), on a wiped `dist`.
  **Format:** clean.
- **Smoke lane (tested locally):** **15 suites, 2261 assertions, 0 failed** — including `m09-docs` (69) and
  `conformance` (**827**, validating every `@Endpoint` permission + audit code against the registries, the RLS
  convention over the new migrations, `registered_code_count`=len(codes), and GAP-1 for the newly-registered
  `document.lifecycle` family).
- **Migrations (tested locally):** 18 in dependency order; dry-run + **fresh replay from an empty database**.
- **DB lane (tested locally, real PostgreSQL 15.2, non-owner `finapp_app` role):** **22 specs, 626 assertions, 0
  failed** — `m09-docs` (26), `m09-services` (36), `api-documents` (12 HTTP end-to-end), and the whole prior
  baseline still green.
- **CI (PostgreSQL 16, authoritative):** to be observed on the implementation PR — **not yet CI-verified** at the
  time of writing.

Local environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative); Node **v22.14.0**; npm
**10.9.2**.

## Section evidence (matrix)

RLS + isolation + fail-closed, no-DELETE + append-only scan grants, permission seed (27), one-active
type/version + open-checkout + active-hold + idempotency uniqueness, committed-version content-hash CHECK,
self-relationship CHECK (`m09-docs.db-spec`). Type/retention lifecycle + immutability, default-deny, metadata
validation, classification-downgrade control, **server-verified upload (hash/size mismatch rejected)**,
scan-gated activation, ACL grant/revoke, single-winner checkout, relationship acyclicity, **legal-hold blocks
disposition**, disposition **SoD (requester ≠ approver)** + execute-with-tombstone, cross-tenant isolation
(`m09-services.db-spec`). HTTP: 401 anon, 403 unprivileged (header can't grant), storage-ref redaction,
completion-forgery refusal, hold-blocks-disposition (409), tenant isolation (`api-documents.db-spec`). Content
safety + retention/relationship/classification math + storage/scan doubles (`m09-docs.smoke`).

## Limitations (deferred, documented — not defects)

- **No production storage/antivirus/OCR/e-signature** — deterministic test doubles only, no secrets; real
  adapters are a future responsibility behind the existing ports (Framework Only, ADR-044/051).
- **No standing retention/expiry sweeper worker** — disposition eligibility is assessed on demand; a background
  sweeper is deferred (like m06's SLA path).
- **Content extraction / OCR** and **electronic signature** are modelled as framework hooks (flags on the type;
  approval orchestration delegates to m06 workflow) — not implemented.
- **Recipient/participant directory resolution** for ACL grantees is by declarative ref; org-directory data
  owned by later modules is not invented.

## Scope discipline (contamination)

Only `m09-docs` (+ its API wiring, registries, contracts family, tests, docs) was built. **No m12/m13/finance/
reconciliation/AI/production-OCR/production-AV/production-e-sign implementation** (grep of the merge diff for
those returns nothing but registry/doc lines). No shared platform service was duplicated; no second outbox; no
duplicate audit table; no second RBAC engine. The manifest change is confined to the m09 block + the
`certification_2_4` finalization. The implementation PR is open; it is **not merged**.
