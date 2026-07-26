# Stage 2.5 — M09 Enterprise Document Management — Readiness

**Verdict: GO** (built on certified Stage 2.4 baseline `30b69c2`, PR #17 merged and verified).

## Dependencies available

- **kernel** — `DB`/`AUDIT`/`AUTHZ`/`OUTBOX` tokens, `@Endpoint`, `ProblemError`. ✅
- **m01-tenant** — tenancy control plane + `RecordingAudit`/`RecordingOutbox` test doubles. ✅
- **m02** — real RBAC (`RbacAuthz`) + the `permissions` catalogue m09 seeds into. ✅
- **m03-audit** — the single audit spine (kernel `AUDIT` port). ✅
- **m06-workflow** — owns the single outbox; m09 publishes `document.lifecycle` through it; approval
  orchestration delegates here. ✅
- Test harness, migrate tool (m09-docs already in `module-order`), conformance. ✅

## Security boundaries

- Content bytes live behind the storage port, never in PostgreSQL; only an opaque storage reference is persisted
  and it is redacted from API responses.
- Filenames are safe leaf labels (traversal/control/reserved chars rejected); the module never builds a
  filesystem path or remote URL from user input (no SSRF, no traversal).
- Every endpoint enforces its `documents.*` RBAC permission; document ACLs supplement, never replace, RBAC.
- Classification downgrades require platform authority; scan gate blocks release of unscanned/infected content.

## Storage abstraction

`DocumentStorage` port (put/head/read/purge) + `ContentScanner` port, both bound to deterministic in-memory test
doubles (Framework Only). Upload is server-verified: the server reads the object's actual hash + size and rejects
any mismatch — a client cannot forge completion.

## Privacy risks & mitigations

- **Content/PII leakage** → audit/events/scan evidence carry ids/hashes/states only (ADR-046); views redact
  storage refs, lease internals, and raw scan payloads.
- **Object-key guessing / cross-tenant access** → RLS FORCE on all tables; storage refs are uuid-based and never
  returned; downloads are server-mediated and permission + scan + status gated.
- **Improper destruction** → legal hold blocks disposal; disposal is request → SoD approval → execute with a
  tombstone; no hard DELETE.

## Assumptions

- No real storage/AV/OCR/e-signature provider is configured → deterministic doubles only; real adapters deferred.
- Recipient/participant directory data owned by later modules → ACL grantees are declarative refs.

## Exclusions (verified out of scope)

No m12 feedback / m13 case / finance / reconciliation / AI / production OCR / production AV / production e-sign /
cloud-specific storage / document editor / collaborative suite / enterprise search / external portal.

## Implementation gates

format · lint (wiped dist) · build · smoke · conformance · migrations (dry-run + fresh replay) · DB specs · API
specs · RLS · permissions · audit · events · outbox · idempotency · concurrency · append-only · security
negatives · storage-adapter · contamination. PostgreSQL 16 CI is authoritative.

## Deferred provider integrations

Real object storage (S3/Azure/GCS), antivirus, OCR/extraction, and electronic signature — all behind existing
ports; a standing retention/expiry sweeper worker.
