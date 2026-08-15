# Security & GRC

The Phase 6H security control plane (m41-security, 79 reference tables) governs POSTURE over the whole platform
and never replaces the authoritative controls (auth verifies identity, RBAC enforces permissions, audit records,
encryption protects data).

## Domains
Identity Governance & Administration (JML, access requests, certification, dormant/orphaned detection, SoD),
Privileged Access Management (just-in-time, time-bound, break-glass), Zero Trust (deny-by-default posture over
RBAC), Data Classification & DLP (server-side, no bypass), cryptography & key governance (references only, no raw
keys; algorithm deprecation), GRC (frameworks, controls, policies, evidence, risk register, exceptions,
third-party risk), privacy (processing registry, DPIA, data-subject requests that cannot bypass lawful
restrictions), and SOC readiness (event catalogue, detection, alerts, vulnerabilities).

## Non-negotiables
Least privilege · deny by default · SoD + no self-approval · time-bound privileged access · classification
before sensitive-data handling · encryption in transit + at rest · controlled key management (no raw key
storage) · server-side DLP · versioned immutable-once-published policies · time-bound risk acceptance · controlled
expiring exceptions · DSRs cannot bypass legal hold / retention / investigation · idempotent security-event
ingestion · no security event disappears silently · no audit evidence overwritten.

## Compliance stance
Technical controls produce **readiness and evidence**, not certification. ISO 27001 / SOC 2 / GDPR / Kenya DPA
are tracked as readiness with evidence; certification is never claimed from technical controls alone.

## Implementation status (Stage 6H — FRAMEWORK-ONLY, ADR-128)

Delivered on `feature/stage-6-m41-security`: the governed **secret/key/DLP/GRC/privacy METADATA + lifecycle** —
**13** governed `security_`/`grc_`/`privacy_` tables (5 mutable aggregates + 8 append-only ledgers) reconciled from
the 79-table reference baseline. This is the honest MVP cut; the remaining reference domains (IGA JML/certification,
full PAM break-glass, risk register, DPIA/DSR workflow, SOC detection) are documented, not yet built.

**The load-bearing secret boundary (ADR-116/128).** m30 owns the opaque `secretref:` **seam**; m41 owns the **real**
secret/key backend — but there is **no approved KMS/HSM/Vault provider** (OPEN_QUESTIONS #10/#16), so m41 ships
**framework-only**: there are **ZERO** secret-value / ciphertext / plaintext / token / private-key / password /
material columns anywhere (DB-proven). A secret is an opaque `secret_ref` (a `secretref:`-shape CHECK) + an approved
algorithm id + an opaque `provider_ref` only. Raw secret-**value** storage, all crypto, and the provider are
**deferred** behind a fail-closed `SecretProviderPort` (default `UnavailableSecretProvider` ⇒ no material is ever
produced, stored, logged or leaked). Persisting a raw secret value without an approved provider is a **blocker** and
is excluded at this stage. The real provider drops in behind the port unchanged.

**Backs the deferred ports.** `SecretService.resolveSecretMetadata` is the real resolver backing m30's `SecretResolver`
(availability **metadata** only; fails closed for a revoked/retired/destroyed/missing secret or an unavailable
provider; never a value). `DlpService.evaluate` is the canonical fail-closed implementation behind m24's
`DlpPolicyEvaluator` (restricted data that looks secret, matches a block policy, or is ungoverned is **blocked**;
a bounded finding is recorded, never the content). m24 stays the AI-orchestration owner.

**Controls proven by tests.** Posture over RBAC (m02 RBAC **AND** m41 posture; any deny denies; posture never grants).
Secret create/activate/rotate/reveal/revoke/destroy — including a plaintext reveal — are maker-checker/SoD (a human
approver ≠ the requester; AI/system/automation refused; rotate/reveal/destroy privileged; a reveal returns no
material). Rotation is **race-safe** (a one-active partial unique index + aggregate version CAS = exactly one winner).
No home-grown crypto (an approved-algorithm allowlist + opaque refs). GRC does not duplicate the m03 audit spine or
m42 certification; privacy records are bounded evidence over an opaque subject reference (no personal data).

**Surface.** `/api/v1/security` + `/api/v1/grc` + `/api/v1/privacy`; `security.*`/`grc.*`/`privacy.*` (14 permissions,
4 privileged); `SEC_`/`GRC_`/`PRIV_` audit (18 codes); 7 `security.*` event families (12 types) through the one m06
outbox (m41 owns none). Every tenant table is FORCE-RLS with composite tenant-safe FKs; a cross-tenant secret
resolution hard-fails. See ADR-128 and `manifests/implementation-manifest.yaml` (`implementation_6_m41`).
