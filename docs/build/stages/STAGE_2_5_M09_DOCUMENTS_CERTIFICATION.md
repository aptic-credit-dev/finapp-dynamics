# Stage 2.5 — M09 Enterprise Document Management — Post-Merge Certification

**Date:** 2026-07-26
**Module:** `m09-docs` (enterprise document & records management: controlled records, immutable versions,
storage ports, metadata, access, retention, legal hold, disposition, scan evidence).
**Verdict:** ✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS** (certification on branch `cert/stage-2-5-m09-documents`;
certification PR pending, not merged).

## 1. Identity

| Fact | Value |
| --- | --- |
| Implementation PR | **#18** |
| Reviewed implementation head | `ac3c24b962602b95332ded543fa92a716c919f11` |
| Implementation merge SHA (squash) | `9b99c218e3cc74ca2c2fea45881538dd897a0de3` |
| Certified baseline SHA (main tested) | `9b99c218e3cc74ca2c2fea45881538dd897a0de3` |
| Certification branch | `cert/stage-2-5-m09-documents` (cut from merged main) |
| Parent baseline (pre-merge main) | `30b69c2534f7ce224d278c73b3872019f5472ac9` (certified Stage 2.4, PR #17) |
| PR #18 | `state: closed`, `merged: true`, `merged_at: 2026-07-26T15:22:11Z` |

**Tree-equivalence:** PR #18 was **squash-merged** (`9b99c21` has a single parent `30b69c2`), so the reviewed
head is not a literal ancestor — ancestry is not required. `git diff ac3c24b 9b99c21` is **empty**: the merged
tree is **byte-identical** to the reviewed head across the entire repository. No unexpected files.

## 2. Scope certified (merge diff `30b69c2..9b99c21`)

ADR-044…051; the m09 architecture/readiness/plan/completion docs + this certification report;
`packages/m09-docs` (domain, storage + scan ports, migrations, repository, services, emitter, permissions/audit
codes, tests); `packages/contracts/src/document-events.ts` + the `DomainEvent` union (8 families) + the contracts
smoke; documents permissions (27, registered **and seeded**); documents audit codes (30); event-registry
`document.lifecycle` (GAP-1 closed) + naming-map flag; m09 migrations; `/api/v1/documents` API (10 files under
`apps/api`) + `AppModule` wiring; m09 tests; build wiring (`tsconfig.json`); manifest Stage 2.5 block + the
`certification_2_4` finalization; the assertion-count bump in `contracts`/`m02-identity` smoke.

**Exclusions (verified absent):** no m12/m13/m14/m15/m19+/finance/reconciliation/AI implementation; no production
OCR / antivirus / e-signature; no cloud-specific storage SDK; no document editor / collaborative suite /
enterprise search / portal (grep of the merge diff returns nothing but registry/doc lines). **No second outbox;
no duplicate audit table; no second RBAC engine; no duplicate shared platform service.**

## 3. Local gate results (baseline `9b99c21`)

Environment: PostgreSQL **15.2** throwaway (CI PostgreSQL 16 is authoritative — see §12); Node **v22.14.0**;
npm **10.9.2**; connected via `DATABASE_APP_ROLE=finapp_app` (non-superuser, RLS enforced). Lint ran on a
**wiped `dist`** (CI lint-before-build order).

| Gate | Result |
| --- | --- |
| Format check | ✅ PASS |
| Lint (wiped dist) | ✅ **0 errors** (15 pre-existing non-blocking warnings only) |
| Build / typecheck | ✅ 0 type errors |
| PURE smoke | ✅ **15 suites, 2261 assertions, 0 failures** (m09-docs 69) |
| Conformance | ✅ **828 assertions** (endpoint perms/audit + RLS convention + `registered_code_count`=len + GAP-1) |
| Migration dry-run | ✅ **18 migrations**, dependency order, checksums valid |
| Fresh PostgreSQL replay | ✅ **18 applied, 0 already-applied** (from an empty database) |
| DB integration + API specs | ✅ **22 specs, 626 assertions, 0 failures** (m09-docs 26, m09-services 36, **api-documents 12**) |

## 4. Database governance (live checks on `finapp_ci`)

- **RLS:** all **10** m09 tables report `relrowsecurity=t` AND `relforcerowsecurity=t` (10/10); each has a
  `tenant_isolation` policy (10/10). Composite `(tenant_id,id)` PKs; **8** composite tenant-safe FKs.
- **Grants:** **0 DELETE** grants to `finapp_app` on any m09 table; `document_scan_result` grants exactly
  `INSERT, SELECT` (append-only evidence). Mutable/status-transitioned tables get SELECT/INSERT/UPDATE.
- **Constraints/indexes:** one-active (`document_type_one_active`, `retention_policy_one_active`,
  `document_version_one_active`); idempotency (`document_idem_key`, `document_version_idem_key`,
  `document_disposition_idem_key`); single-winner checkout (`document_checkout_open_key`); active-uniqueness
  (`document_access_grant_active_key`, `document_legal_hold_active_key`, `document_relationship_active_key`);
  the committed-version content-hash + byte-size CHECK (`document_version_committed_ck`).
- **No binary content in PostgreSQL:** zero `bytea`/`oid` columns on any m09 table — bytes live behind the
  storage port; only an opaque storage reference is persisted (ADR-044). No hidden superuser dependency (the DB
  lane runs as the non-owner `finapp_app`).

## 5. Storage abstraction (§9)

Storage is a `DocumentStorage` **port** (put/head/read/purge) with a deterministic `InMemoryStorage` test double.
Verified: **no hardcoded cloud provider** (no AWS/S3/Azure/GCS SDK), **no committed credentials/secrets** (the
only matches are doc comments documenting their absence), PostgreSQL stores an **opaque storage reference only**,
API version views **redact** the storage reference, the port never returns a credential, and there is no
arbitrary-filesystem-path or arbitrary-remote-URL fetch. Content scanning is a `ContentScanner` port with a
deterministic double. Framework Only (ADR-051).

## 6. Upload integrity (§10)

Two-step, **server-verified**: initiate creates a PENDING version with a storage reference; complete reads the
object's ACTUAL hash + size from the storage port and **rejects any mismatch** — a client cannot forge
completion (proven: `m09-services` rejects a wrong-hash completion; `api-documents` refuses completion with no
stored object). Media type is validated against the type's allow-list; filenames are normalized with a strict
traversal/control/reserved-char guard. On commit the version freezes its content hash + byte size (CHECK) and
records append-only scan evidence; committed content columns are never mutated.

## 7. Versioning & lifecycle (§11-12)

Immutable committed versions; unique version numbers (`document_version_num_key`); exactly **one ACTIVE** version
per document (partial unique); a committed version requires a content hash + byte size (CHECK). Activation
supersedes the prior active version and sets the retention anchor + earliest-disposition date. Document lifecycle
draft→active→superseded/archived/withdrawn→disposed with invalid transitions rejected; disposal leaves a
**tombstone**. Proven end-to-end in `m09-services`.

## 8. Types / retention / metadata / classification / ACL (§13-16)

Document types + retention policies are versioned, immutable-after-publish specs (one ACTIVE per code,
content_hash frozen). Metadata is typed and validated against the type's schema (required present, unknown
rejected, bounded) — never unbounded JSON. Classification is enforced server-side; a **downgrade requires
platform authority** (proven: a downgrade without `documents.platform.administer` is refused). Document ACL
grants **supplement** RBAC (never replace it); grants are tenant-scoped, explicit, audited, revocable (ADR-048).

## 9. Checkout / relationships / legal hold / disposition / scan (§17-21)

- **Checkout:** single-winner lease (`document_checkout_open_key`); non-owner release refused; forced release is
  privileged; expired leases reclaimable (proven).
- **Relationships:** typed, tenant-consistent, self-edge rejected (CHECK), **acyclic** for supersedes/derived_from
  (proven: a cycle-closing edge is rejected).
- **Legal hold:** placed with permission + reason; one active per document; **always blocks disposal** (a hard
  guard, fail closed); release preserved as history; no DELETE.
- **Disposition:** request → **privileged approval by a different actor (maker≠checker)** → execute, which purges
  object bytes but leaves a **tombstone** (document set `disposed`, disposition + version rows remain). Blocked by
  an active hold at request and execute. Idempotency-key unique. Proven in `m09-services`.
- **Scan:** a version is not activatable/downloadable until scan status is `clean`/`bypassed` (proven: an infected
  version cannot activate); evidence is append-only and records status + scanner code + a safe signature only —
  never a payload (ADR-046/051).

## 10. Idempotency & concurrency (§25-26)

DB-enforced idempotency on document creation, upload initiation/version, and disposition (partial unique
indexes); a repeat returns the stored row, a different payload → 409 (proven in `m09-services` + `api-documents`).
Concurrency safety via optimistic locks, unique constraints, and the single-winner checkout lease; the
committed-version and one-active invariants are DB-enforced.

## 11. Authorization, audit, events & outbox (§27-30)

- **Authorization:** **27** `documents.*` permissions, **seeded** (11 privileged: type/retention manage, access
  grant/revoke, checkout force-release, legal-hold manage, disposition approve/execute, scan override, document
  withdraw, platform administer); every mutating route declares its 3-segment permission (`@Endpoint`), enforced
  server-side (default deny). Proven over HTTP: an `x-permissions` header cannot self-grant (403).
- **Audit:** **30** `DOC_*` codes via the m03 `AUDIT` port (no duplicate audit table); `registered_code_count`
  148→**178** = len(codes) (conformance-enforced); payloads carry ids/states/hashes only — no content, extracted
  text, credentials, signed URLs, or keys.
- **Events / contracts:** `document.lifecycle`, **22** event types (version 1), owned by m09, registered in
  event-registry + naming-map (`event_family_registered: true`, GAP-1 closed), and in the contracts `DomainEvent`
  union (7→**8** families).
- **Outbox:** m09 owns **no** outbox — the only `%outbox%` table is m06's `workflow_event_outbox`. m09 publishes
  through it in the caller's transaction (atomic, no dual-write, no second delivery path). ADR-004/044.

## 12. Authoritative CI (PostgreSQL 16)

Implementation PR **#18**, head `ac3c24b`, run **30207851985** (`pull_request`) — **Smoke lane + DB lane both
`success`** on `postgres:16` (the DB lane asserts `server_version_num` is 16.x). Post-merge push to main
`9b99c21`, run **30208050617** (`push`) — **success**. The merged tree is byte-identical to the reviewed head, so
the PG16 evidence transfers to the certified baseline. The local PG15.2 run independently re-confirms every gate.

## 13. Integration (§31)

m09 integrates with m06/m07/m08 through **events/contracts only** (no import cycle): workflow can gate on
document submission/approval; rules consume typed document facts, never raw content; notifications are emitted via
m08. A notification/scan failure never mutates a committed version or a completed decision. No additional
m06/m07/m08 functionality was implemented during certification.

## 14. Repository-derived counts (§33)

| Item | Count |
| --- | --- |
| Source files changed vs Stage 2.4 baseline (excl. build output) | **55** (+6647 / −47) |
| Migrations (m09) | **2** (18 total in the repo) |
| Tables | **10** |
| Permissions (`documents.*`) | **27** (11 privileged) |
| Audit codes (`DOC_*`) | **30** |
| Event types (`document.lifecycle`) | **22** |
| API endpoints | **30** mutating + **12** reads |
| Smoke suites / assertions | **15** / **2261** (m09 69, conformance 828) |
| DB specs / assertions | **22** / **626** (m09-docs 26, m09-services 36, api-documents 12) |
| ADRs | **8** (ADR-044…051) |

## 15. Documented limitations (deferred, not defects — each verified)

- **No production storage adapter, antivirus, OCR, or e-signature** — `DocumentStorage` + `ContentScanner` ports
  with deterministic in-memory doubles; no cloud SDK, no secrets committed. Real adapters are a future
  responsibility (Framework Only, ADR-044/051).
- **No always-running retention/expiry sweeper** — disposition eligibility is assessed on demand; a background
  worker is deferred.
- **Content extraction / OCR** and **electronic signature** are framework hooks (flags on the type; approval
  orchestration delegates to m06 workflow) — not implemented.
- **Recipient/participant directory resolution** for ACL grantees is by declarative ref; org-directory data owned
  by later modules is not invented.

None weakens any architecture, RLS, authorization, audit, immutability, retention, or test guarantee.

## 16. Verdict

✅ **CERTIFIED WITH DOCUMENTED LIMITATIONS.** The M09 enterprise document & records management module is
implemented on `main` (`9b99c21`), byte-identical to the reviewed PR #18 head, with all certification gates
executed and green locally and both authoritative PG16 CI lanes green. Certification is recorded on branch
`cert/stage-2-5-m09-documents`; the certification PR is pending and **not merged**. No later module (m12+) was
touched.
