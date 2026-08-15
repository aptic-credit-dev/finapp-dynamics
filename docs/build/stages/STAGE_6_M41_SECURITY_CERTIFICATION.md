# Stage 6H — M41 Enterprise Security / Privacy / Compliance / GRC — Certification

**Module:** `m41-security` · **Verdict:** **CERTIFIED ON BRANCH** · **Date:** 2026-08-15. **Twelfth Stage-6 module certified; first Stage-6H module.**
**ADR:** ADR-128 (with ADR-116/ADR-009). The load-bearing secret boundary — M30 owns the opaque `secretref:` seam (zero secret-value columns); M41 owns the REAL secret/key backend but ships **FRAMEWORK-ONLY** because there is no approved KMS/HSM/Vault provider (OPEN_QUESTIONS #10/#16): governed secret/key/DLP/GRC/privacy metadata + lifecycle with ZERO secret-value/ciphertext/token/private-key/password/material columns anywhere; raw-value storage + crypto + provider are deferred behind a fail-closed `SecretProviderPort` (default `UnavailableSecretProvider`). `SecretService.resolveSecretMetadata` backs M30's `SecretResolver` (metadata only, never a value); `DlpService.evaluate` is the canonical fail-closed impl behind M24's `DlpPolicyEvaluator` (M24 stays the AI owner). Posture over RBAC (augments M02, never grants); maker-checker/SoD over every high-risk secret action; race-safe rotation; no home-grown crypto; `security.*`/`grc.*`/`privacy.*` (no GAP); `security_*`/`grc_*`/`privacy_*` prefixes.

## A. Merge & baseline

| Item | Value |
|------|-------|
| Governance PR | #106 — merged → `main` `b508129` (m41 `approved_for_build`) |
| Implementation PR | #107 — closed, merged, merged_at `2026-08-15T15:07:28Z` |
| Reviewed implementation head | `273ca1b` (`273ca1b1e69a931062927ec756c66a4d8c54ee9a`) |
| Implementation merge SHA | `a35f5bf3c7c89865424fca4d1bf5393c288c0327` (single parent `b508129` = squash) |
| Tree equivalence | `git diff 273ca1b a35f5bf` = **EMPTY** (byte-identical) |
| Current `main` / certification baseline | `a35f5bf3c7c89865424fca4d1bf5393c288c0327` |
| Certification branch | `cert/stage-6-m41-security` (from `a35f5bf`) |
| Implementation CI (reviewed head `273ca1b`) | Smoke lane **success** · DB lane (PostgreSQL 16) **success** |

## B. Scope confirmed

module `m41-security` · Stage 6H · **Enterprise Security / Privacy / Compliance / GRC** · **mvp:false** ·
**`/api/v1/security` + `/api/v1/grc` + `/api/v1/privacy`** · `security.*` + `grc.*` + `privacy.*` permissions · audit prefixes
**`SEC_` / `GRC_` / `PRIV_`** · **7 `security.*` event families** · one m06 outbox · M41 owns the governed secret/key/DLP/GRC/
privacy metadata + lifecycle and the **real secret-management boundary** (framework-only) · **M41 owns NO RBAC engine (m02
authoritative — posture augments, never grants), NO audit spine (m03 authoritative), NO AI/DLP-orchestration engine (m24
authoritative — m41 supplies the DLP decision + evidence), NO secretref seam (m30 authoritative — m41 is the real backend behind
it) and NO duplicate outbox** · uses the **`security_` / `grc_` / `privacy_`** table prefixes (no collision with any prior
module) · `reference_tables` **79 → 13** governed core.

## C. Local certification gates (clean checkout on baseline `a35f5bf`, PostgreSQL 15.2 throwaway, non-owner `finapp_app`)

| Gate | Result |
|------|--------|
| format:check | pass (all matched m41 / security-api / contracts files use Prettier code style) |
| lint | **0 errors** (68 pre-existing baseline warnings; m41 adds none) |
| build (`tsc --build`) | pass |
| smoke lane | 46 suites, **7736** assertions, 0 failures (m41-security **106** · conformance **3864** · migrate **26**) |
| fresh migration replay | **80** migrations applied (m41 = 2; no historical migration edited) |
| — m41 checksums | `0001_security.sql` `6c9d35231c88` · `0002_grant_application_role.sql` `5e995d431671` |
| DB/API lane (fresh DB) | **95** specs, **2878** assertions, 0 failures |
| — `m41-security` DB spec | 31 |
| — `m41-services` DB spec | 23 |

Authoritative CI is **PostgreSQL 16**; the local lane ran on PG 15.2 (honest — no PG16 claimed locally). The implementation
PR's PG16 lanes on the reviewed head `273ca1b` and this cert PR's lanes are the authoritative PG16 evidence. A DB re-run against
a **non-fresh** DB trips the known identity/auth pollution specs (login/session uniqueness) — not an M41 defect; the fresh-DB
run is 95/2878/0-fail.

## D. Database — live catalogue evidence (m41-owned 13 tables, non-owner application role)

13 tables · **13/13 RLS ENABLE + FORCE · 13/13 `tenant_isolation` · 13/13 composite `(tenant_id, id)` PKs** · **3 composite
tenant-safe FKs · 0 unsafe single-column tenant FKs** (every FK includes `tenant_id`) · **0 DELETE grants** · 8 append-only
ledgers (INSERT+SELECT, **0 UPDATE**: `security_reveal`, `security_dlp_finding`, `security_incident`, `security_review`,
`security_history`, `security_idempotency`, `grc_assessment`, `privacy_record`) · 5 mutable aggregates (INSERT+SELECT+UPDATE:
`security_secret`, `security_secret_version`, `security_dlp_policy`, `grc_control`, `privacy_classification`) · **38 governance
CHECK constraints** · 5 version columns · **0 float** (retention is integer) · **0 secret-value / ciphertext / plaintext /
token / private-key / password / material / credential columns** (2 opaque pointers only: `security_secret.secret_ref` with a
`secretref:` shape CHECK + `security_secret_version.provider_ref`) · **1 immutability trigger** (`security_secret_version`) ·
**1 one-active partial unique index** (`security_secret_version WHERE state='active'` — rotation race-safe) · **1 outbox (m06
`workflow_event_outbox` — m41 owns none)** · **14 `security.*`/`grc.*`/`privacy.*` permissions** (**4 privileged**, all
3-segment, no `security.admin`/`grc.admin`/`privacy.admin`/wildcard, no 4-segment code) · **18 `SEC_`/`GRC_`/`PRIV_` audit
codes** · 7 event families (14 event types) · **80 total migrations**. reference_tables reconciled **79 → 13** (documented).

## Verdicts

| Aspect | Verdict |
|--------|---------|
| **The load-bearing secret-value boundary** — a live scan of `information_schema.columns` across all 13 tables finds **0** columns matching secret-value / ciphertext / plaintext / private-key / password / token / material / `key_material` / credential; a secret is an opaque `security_secret.secret_ref` (a `secretref:`-shape CHECK — a raw value cannot be persisted) + an approved algorithm id + an opaque `security_secret_version.provider_ref`. Raw-value storage, crypto and the provider are deferred behind a fail-closed `SecretProviderPort`; the default `UnavailableSecretProvider` yields no material (a reveal returns `secret_provider_unavailable` with **no** material) | **PASS** |
| **M30 remains the secretref-seam owner; M41 is the real backend** — the m41 diff touches **no** `m30-platform` file; M30 keeps the opaque `secretref:` seam (zero value columns). `SecretService.resolveSecretMetadata` is the real resolver backing M30's `SecretResolver` contract shape `{available, reasonCode}` — proven in the services spec: an active secret ⇒ available (`secret_reference_resolvable`); a revoked / missing secret ⇒ unavailable; an active secret with an unavailable provider ⇒ unavailable — **fail closed, never a value** | **PASS** |
| **M24 remains the DLP/AI owner; M41 supplies the fail-closed decision** — the m41 diff touches **no** `m24-ai-foundation` file; `DlpService.evaluate` is the canonical implementation behind M24's `DlpPolicyEvaluator` port shape `{action, reasonCode, findingCount}` and **fails closed**: restricted data that looks secret ⇒ block; restricted data with **no governing active policy** ⇒ block (proven live); a bounded finding (classification/action/reason/count) is recorded — **never the restricted content** | **PASS** |
| **Framework-only / no approved provider** — actual secret storage, cryptographic operations and the provider integration are deferred behind `SecretProviderPort` (default `UnavailableSecretProvider`) pending an approved KMS/HSM/Vault strategy (OPEN_QUESTIONS #10/#16); no production provider, no network egress, no crypto is performed here; honest status per CLAUDE.md | **PASS** |
| **Posture over RBAC (ADR-009)** — effective access = M02 RBAC **AND** M41 posture (`evaluateSecurityPosture`); **any deny denies** and posture can only DENY. Proven live in the services spec: RBAC-deny + security-allow ⇒ deny (`rbac_denied`); RBAC-allow + security-deny ⇒ deny (`security_policy_denied`); RBAC-allow + security-allow ⇒ allow. Security never grants what RBAC denies; no duplicate RBAC engine | **PASS** |
| **Maker-checker / SoD + AI restriction** — secret create/activate/rotate/reveal/revoke/destroy — including a plaintext reveal — require a HUMAN approver who is **not** the requester (`evaluateSodGate` + `isHumanActor`: null/blank/`system`/`ai`/`automation` ≠ human; DB SoD CHECKs on `security_reveal.approved_by <> requested_by` and `security_review.decided_by <> requested_by`). Proven live: self-approval refused, `ai` approver refused, an independent human approves; rotate/reveal/destroy are privileged | **PASS** |
| **Concurrent secret rotation — one winner** — a one-active **partial unique index** (`security_secret_version WHERE state='active'`) guarantees at most one active version; the aggregate **version CAS** claims the rotation. Proven live: a second concurrent `active` version insert is rejected by the index, and two concurrent `rotateSecret` calls at the same version admit **exactly one winner**, leaving **exactly one** active version (no split-brain). A non-pending version is IMMUTABLE (trigger) | **PASS** |
| **No home-grown cryptography** — an algorithm must be on the approved allowlist (`aes-256-gcm`/`rsa-4096`/`ecdsa-p256`/`chacha20-poly1305`/`ed25519`); a home-grown/arbitrary algorithm is rejected (proven in smoke); the semantic scan finds **zero** `eval`/`new Function`/`child_process`/`createCipher`/`createHash`/`crypto.` in m41 source (the only match is a comment stating the fixture double performs "no network, no crypto") | **PASS** |
| **No arbitrary execution / unapproved provider or network egress** — zero `eval`/`Function`/`vm`/`child_process`/`spawn`/shell/`fetch`/`http(s).request`/`net.`/`axios` in m41 source or the security API; provider operations are deferred fail-closed; no production network/provider egress | **PASS** |
| **GRC boundary** — GRC control catalogue + assessments are append-only evidence; they do **not** duplicate the M03 audit spine or M42 certification (M42 may consume this evidence by contract); every mutation authorizes a `grc.*` permission and is audited | **PASS** |
| **Privacy tenancy / data-leakage** — `privacy_record` is bounded evidence over an **opaque** `subject_ref` (no raw personal-data column); `privacy_classification` holds level + integer retention; both are FORCE-RLS; a cross-tenant read is invisible (proven live for `security_secret`); classifications/records carry no PII | **PASS** |
| **Permissions** — `security.*` (8) + `grc.*` (3) + `privacy.*` (3) = 14 codes, all 3-segment, 4 privileged (`security.secret.rotate`/`reveal`/`destroy`, `security.control.administer`); no wildcard; default deny; platform-scope keys/policies require `security.control.administer` | **PASS** |
| **Audit** — `SEC_`/`GRC_`/`PRIV_`, 18 codes; source↔registry parity **18/18**; `registered_code_count` **961** = len(codes); no code carries another module's prefix; payloads carry ids/states/classifications/approved-algorithm ids/reason codes only — **never a secret value, ciphertext, token, credential or raw restricted content** | **PASS** |
| **Events / outbox** — 7 `security.*` families (`identity`/`privileged`/`dlp`/`crypto`/`grc`/`privacy`/`soc` `_lifecycle`), **14 event types** (1+2+2+4+2+2+1), registered once (m41-owned, newest tail), privacy-safe payloads; one m06 outbox (m41 owns none); no fake business-domain events | **PASS** |
| **No REST bypass** — every mutating route across the 3 controllers authorizes a `security.*`/`grc.*`/`privacy.*` permission + carries an auditCode via `@Endpoint` (**12 guarded mutating routes**: security 8, grc 2, privacy 2); the single read (`GET /security/secrets`) carries no `@Endpoint` and enforces the read permission in-service; there is **no secret-material download endpoint** | **PASS** |
| Contamination | **CLEAN** |

## Metrics

migrations 2 (total 80) · tables 13 · FORCE RLS 13 · policies 13 · composite PKs 13 · composite FKs 3 · unsafe tenant FKs 0 ·
DELETE grants 0 · append-only ledgers 8 (0 UPDATE) · mutable aggregates 5 · governance CHECKs 38 · version columns 5 · float 0 ·
secret-value/token/credential columns 0 · opaque secretref pointers 2 (`secret_ref`, `provider_ref`) · immutability triggers 1 ·
one-active partial unique index 1 · permissions 14 (privileged 4) · audit codes 18 (registry 961; parity 18/18) · event families
7 (**14 event types**) · outboxes 1 (m06) · routes `/api/v1/security` + `/grc` + `/privacy` (**12 guarded mutating** + 1
in-service-guarded read) · smoke 7736/46 · conformance 3864 · DB/API 2878/95 (m41-security 31 · m41-services 23).

## Contamination — CLEAN

The implementation branch changed only: `packages/m41-security/*` (new); `apps/api/src/security/*` (new) + 2 lines wiring
`SecurityModule` into `apps/api/src/app.module.ts`; the 7 `security.*` families in `packages/contracts/src/security-events.ts`
(new) + their re-export in `packages/contracts/src/index.ts` + their union/registry wiring in `packages/contracts/src/events.ts`;
the family-count smoke assertions in `packages/contracts/test/contracts.smoke.ts` and `packages/m02-identity/test/m02-identity.smoke.ts`;
registries/manifests/docs; and `tsconfig.json` / `apps/api/tsconfig.json` / `package-lock.json`. **m01–m40 source untouched** —
in particular **`m30-platform` and `m24-ai-foundation` are NOT in the diff**, so M30 stays the secretref-seam owner and M24 stays
the DLP/AI owner (M41 backs their deferred ports by contract; the composition-root adapters drop in later without changing
consumer domain logic). M41 owns no outbox; no `resilience_*`/`saas_*`/`automation_*`/`govrelease_*`/`webhook_*`/`devportal_*`/
`marketplace_*`/`connector_*` prefix collision (m41 uses `security_`/`grc_`/`privacy_`); no second RBAC/audit/DLP/secret-seam/
outbox engine; no home-grown crypto; no arbitrary-execution or network-egress path; no historical migration edited; no
permission/RLS bypass; no m42 implementation.

## Documented limitations

- `mvp:false`. reference_tables reconciled **79 → 13** — the governed security/GRC/privacy core; the remaining reference domains
  (full IGA JML/certification, PAM break-glass, risk register, DPIA/DSR workflow, SOC detection) are documented, not yet built.
- **FRAMEWORK-ONLY secret backend.** There is no approved KMS/HSM/Vault provider (OPEN_QUESTIONS #10/#16), so actual secret-value
  storage, cryptographic operations and the provider integration are deferred behind a fail-closed `SecretProviderPort`
  (`UnavailableSecretProvider` ⇒ no material). The real provider drops in behind the port unchanged; M30's seam and every
  downstream `secretref:` consumer keep working.
- **Deferred-port adapters not yet wired at the composition root.** M41 provides the real resolver (`resolveSecretMetadata`) and
  the fail-closed DLP (`evaluate`), proven by tests against the M30 `SecretResolver` / M24 `DlpPolicyEvaluator` contract shapes,
  but the app-level adapters binding them into M30/M24 DI tokens are deferred (M30 keeps `UnavailableSecretResolver`, M24 keeps
  its deterministic DLP double) — consumer source stays untouched; the adapters drop in later.
- **Documentation-only metric discrepancies in the merged `implementation_6_m41` manifest block** (no code / CI / security
  impact; flagged for a follow-up doc correction — not fixable under evidence-only certification):
  - `event_types: 12` — **repository truth is 14** (7 families: identity 1 + privileged 2 + dlp 2 + crypto 4 + grc 2 + privacy 2
    + soc 1). The machine-validated figure (7 families) is correct; only the prose type count is off. The same "12 types" prose
    appears in ADR-128, the naming-map note and the event-registry comment.
  - `guarded_routes: 15` — **repository truth is 12** `@Endpoint`-guarded mutating routes (the "15" counted three JSDoc lines
    reading "*Reads carry no `@Endpoint`*"). Route↔guard parity is exact (12 mutating routes, 12 guards).
- Security posture-adapter runtime, the real KMS/HSM/Vault provider, and certification (m42) are deferred (not this module).

## Report path

`docs/build/stages/STAGE_6_M41_SECURITY_CERTIFICATION.md` (this file); implementation evidence lives in PR #107.

## Verdict: **CERTIFIED ON BRANCH**

Evidence-only certification. No runtime code, migration, test, registry or contract was changed on this branch.
