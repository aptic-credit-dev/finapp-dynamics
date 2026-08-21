# Stage 7 — Secrets Provider (Vault-compatible) Decision Package

> **A management decision package, not an implementation.** It compares suitable **self-hosted** Vault-compatible
> products for the M41 `SecretProviderPort` and recommends one **for human approval**. Per ADR-128 and
> ADR-131, **a governance amendment cannot approve a provider** and **no provider is deployed or bound here** —
> M41 stays framework-only (`UnavailableSecretProvider`, fail-closed) until management approves a **specific
> product + instance + credentials**. No secret values, keys, tokens, or credentials appear in or are created by
> this document. Cloud KMS options (AWS/Azure/GCP) are **out of scope** because OQ#16 approved **self-hosted**
> secrets on Contabo.

---

## 1. What the adapter must satisfy (repository truth)

The seam already exists and is fail-closed. Any approved product is consumed through **one** contract, so the
choice of product does not change application code beyond a single adapter class bound at the composition root.

- **Port:** `packages/m41-security/src/ports.ts` — `SecretProviderPort` with three methods a provider adapter must
  implement:
  - `provision(ctx, { secretRef, algorithm }) -> ProviderOutcome`
  - `resolveMetadata(ctx, providerRef) -> ProviderMetadata`
  - `destroy(ctx, providerRef) -> ProviderOutcome`
  - Return types carry an **opaque `providerRef` only** — "never a secret value, never material". Default
    `UnavailableSecretProvider` returns `{ ok:false, reasonCode:'secret_provider_unavailable' }` for every op.
- **DI binding:** token `M41_SECRET_PROVIDER` (`apps/api/src/security/security.module.ts`), currently
  `useFactory: () => new UnavailableSecretProvider()`. Binding a real provider = swapping this one factory for a
  real adapter; **no other app code changes**.
- **Hard invariants any product MUST preserve:** ZERO secret-value / ciphertext / private-key columns anywhere
  (enforced by `packages/m41-security/test/m41-security.db-spec.ts`); the material **never** enters application
  state, an audit payload, an event, or a log; a REVEAL is maker-checker/SoD and returns metadata, never material;
  rotation stays race-safe (one-active partial unique index + version CAS). The adapter stores/rotates material in
  the provider and returns an **opaque provider reference** (e.g. a versioned key path) — exactly what the port
  already expects.

**Selection criteria (weighted for this platform):** (a) implements the port cleanly with opaque refs + envelope
encryption without exposing key material; (b) self-hostable on Contabo; (c) HA + recovery; (d) auditability;
(e) secret rotation; (f) least-privilege identity/policy; (g) operational complexity; (h) licensing/cost;
(i) production suitability + longevity.

## 2. Candidate comparison (self-hosted only)

| Criterion | **OpenBao** (LF; MPL-2.0) | **HashiCorp Vault** Community (BUSL-1.1) | **Infisical** (self-host; MIT + some ent.) |
| --- | --- | --- | --- |
| Port fit (opaque ref, no material in app) | ✅ KV v2 + **transit** (encrypt/decrypt without exposing keys) → adapter returns opaque path/version | ✅ identical API (KV v2 + transit) | ⚠️ KV + KMS-style APIs; app-secret focused, transit-style envelope less central |
| Vault-API compatibility (adapter portability) | ✅ API-compatible fork of Vault (drop-in) | ✅ (reference) | ❌ different API |
| Self-host on Contabo | ✅ single binary / container | ✅ single binary / container | ✅ Docker/compose |
| HA + recovery | ✅ Integrated Raft storage; snapshot restore | ✅ Integrated Raft storage; snapshot restore | ⚠️ HA via external Postgres/Redis; app-tier HA |
| Auditability | ✅ audit devices (file/syslog); no secret in audit | ✅ audit devices | ✅ audit logs (UI/DB) |
| Rotation | ✅ KV v2 versioning + dynamic secrets + transit key rotation | ✅ same | ✅ rotation + dynamic secrets |
| Least-privilege identity | ✅ AppRole/JWT auth + fine-grained ACL policies scoped to one path | ✅ same | ✅ machine identities + RBAC |
| Operational complexity | ⚠️ medium–high (seal/unseal, Raft, policies) | ⚠️ medium–high (same) | ✅ lower; friendlier UX |
| Licensing / cost | ✅ **MPL-2.0, fully open, no BUSL restriction**, free | ⚠️ **BUSL-1.1** source-available (free for internal non-compete use, but not OSI-open) | ✅ MIT core (some features gated behind paid tier) |
| Longevity / governance | ✅ Linux Foundation, vendor-neutral | ✅ mature, large ecosystem, IBM/HashiCorp | ✅ active startup-backed |

## 3. Recommendation (for management approval — not binding)

**Preferred: OpenBao (self-hosted on Contabo, Integrated Raft storage).**

Rationale: it is **API-compatible with HashiCorp Vault**, so the single `SecretProviderPort` adapter we would
write is **portable to Vault Community with zero code change** if management later prefers commercial support —
i.e. choosing OpenBao does not lock the platform in. It is **fully open (MPL-2.0)** with **no BUSL licensing
exposure**, it provides the **transit engine** (envelope encryption where the key never leaves the vault — the
cleanest fit for the "no material in app state" invariant), Raft HA + snapshot recovery, audit devices, ACL
policies for least privilege, and versioned/dynamic rotation. **Acceptable alternative:** HashiCorp Vault
Community — identical adapter and topology; only the licence (BUSL-1.1) and support model differ. **Infisical** is
viable if management prioritises operational simplicity/UX over Vault-API portability and transit-grade envelope
encryption, but it would make the adapter product-specific.

> This is a recommendation. Management approves the **actual product**. Until then M41 remains framework-only.

## 4. Deployment architecture (post-approval; describes, does not deploy)

```
              Contabo (private network; HTTPS/mTLS only; deny-by-default firewall)
  ┌──────────────────────────────┐        AppRole/JWT auth (least-privilege policy)
  │ finapp API (finapp_app)      │ ───────────────────────────────────────────────┐
  │  M41_SECRET_PROVIDER =       │                                                 ▼
  │   OpenBaoSecretProvider      │        ┌──────────────────────────────────────────────┐
  │   (adapter → opaque ref)     │        │ OpenBao cluster (separate host/VM from app DB) │
  └──────────────────────────────┘        │  • Integrated Raft storage (3 nodes = real HA; │
                                          │    1 node acceptable for staging)              │
                                          │  • transit engine (envelope encrypt/decrypt)   │
                                          │  • KV v2 (versioned secret metadata refs)      │
                                          │  • audit device → file/syslog (no secret)      │
                                          │  • ACL policy scoped to the app's single path  │
                                          │  • auto-unseal (transit) or Shamir (staging)   │
                                          │  • Raft snapshots → off-server backup (see     │
                                          │    STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE)│
                                          └──────────────────────────────────────────────┘
```

- **Placement:** separate host/VM from the application database (blast-radius isolation), private network only,
  TLS/mTLS, firewall deny-by-default (only the API and operators reach the vault API port).
- **HA:** 3-node Raft in production for quorum; a single node is acceptable for staging. Recovery = Raft snapshot
  restore; snapshots are pushed to the approved off-server destination (immutable), tying into the backup/DR
  package.
- **Auth & least privilege:** the API authenticates via **AppRole** (or JWT/OIDC); its ACL policy grants access to
  **only** its own secret path (read/rotate as needed), nothing else. Operators use separate identities.
- **Rotation & audit:** KV v2 versioning + transit key rotation; every access is written to an audit device that
  **never contains the secret value**. Reveals stay maker-checker per ADR-128.
- **Adapter behaviour:** implements `SecretProviderPort`; returns the versioned key path as the **opaque
  `providerRef`**; **fails closed** on any provider error (never a partial/empty success); preserves the
  zero-secret-value-column invariant.

## 5. Credentials / keys required AFTER approval (delivered out-of-band; never committed)

None of these exist yet and none may be invented. On approval, management/Platform-Security must provide, **out of
band (never in Git, logs, or evidence)**:

1. Approved **product + version + topology** (OpenBao vs Vault Community; node count; region confirmed under Kenya
   DPA before any real secret).
2. A reachable **non-production vault instance** URL on the private network + its **TLS CA/cert**.
3. The API's **AppRole `RoleID` + `SecretID`** (or JWT/OIDC config) and the **scoped ACL policy** document.
4. **Unseal/recovery key custody** decision (Shamir key holders or transit auto-unseal source) and who holds them.
5. **Audit-log destination** (file/syslog collector) and retention.
6. Rotation policy (interval, dynamic vs static) confirmation.

On delivery, engineering (ADR-131) implements + binds the adapter **in staging only**, proves fail-closed→available
transition and the zero-secret-value invariant, and records evidence. **Production binding remains gated on the
M42 governed GO.**

## 6. What this establishes / does not establish

- **Establishes:** a bounded product comparison, a recommended self-hosted provider, an exact target architecture,
  and the precise post-approval inputs — enough for a management decision.
- **Does NOT establish:** any deployment, any binding, or any approval. `M41` stays framework-only; the secrets
  blocker (OQ#10/#16) remains open pending human product selection. No provider is bound. No GO.
