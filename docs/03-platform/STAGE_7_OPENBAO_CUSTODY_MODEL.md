# Stage 7 — OpenBao Secret-Material Custody Model (pilot)

> The custody arrangement for the sensitive material produced when the **permanent dedicated** OpenBao staging/pilot
> instance is provisioned (ADR-132). It defines, per material type, **who holds it, where, and how it is protected**
> — identifying the **roles** required, not inventing named individuals. **No secret value, token, key, or unseal
> share appears in this document or anywhere in the repository.** This is a pilot (single-node) custody model;
> GA custody (auto-unseal / HSM) is noted where it differs. Nothing here issues a GO or transitions a workstream.

---

## 1. Principles
- **Never in Git, logs, evidence, CI, or chat.** All material is delivered/held out-of-band.
- **Least privilege + separation of duties.** No single identity holds everything; the party that operates the vault
  is not the sole holder of its recovery material.
- **Fail closed.** Loss of material degrades to unavailability (the app fails closed), never to exposure.
- **Rotation + revocation.** Bootstrap material (root token) is revoked after setup; credentials are rotatable.

## 2. Custody table

| Material | Produced by | Custody (pilot) | Holder role(s) | Protection | GA target |
| --- | --- | --- | --- | --- | --- |
| **Root token** | `operator init` | Used ONCE to bootstrap (transit/policy/AppRole), then **REVOKED**. Not retained. | Platform-Security operator (bootstrap only) | never stored long-term; revoked post-setup | same (root revoked; break-glass via quorum `generate-root`) |
| **Unseal keys** (Shamir shares) | `operator init` (5 shares / threshold 3) | Split among **≥3 custodians**; no custodian holds ≥ threshold; needed only to unseal after a restart | 3 distinct custodians across **Platform-Security, Operations (COO/Ops), Risk & Compliance** | each share held out-of-band (sealed/secret-store per custodian); no two on one system | **transit auto-unseal** (unseal key off-node) — removes manual unseal |
| **AppRole SecretID** (API identity) | `write approle/.../secret-id -wrap-ttl` | Issued **response-wrapped**; engineering unwraps ONCE, injects into the API runtime env/secret store | Platform-Security issues; Engineering consumes | short TTL, renewable; wrapped in transit; never committed | same; consider JWT/OIDC workload identity |
| **TLS private key** (server) | internal PKI / issued (or self-signed for early staging) | On the OpenBao host only, root-readable; not exported | Platform-Security / PKI owner | file perms; rotated on cert renewal | **internal-PKI issued** cert + key (not self-signed) |
| **Snapshot encryption key** (if snapshots are client-side encrypted) | key-gen at backup setup | Held with the backup/DR custody (tied to the same secret store); needed to restore snapshots | Operations (COO/Ops) + Platform-Security | out-of-band; never with the snapshots themselves | same; key rotation policy documented |

## 3. Pilot unseal-share holders (roles, not names)
For the single-node pilot using Shamir (5 shares / threshold 3), the shares must be held by **three distinct
custodians drawn from these roles**, so that unseal requires cross-functional cooperation and no single person can
unseal alone:
1. **Platform-Security** (owns the vault operation).
2. **Operations (COO/Ops)** (owns availability/recovery).
3. **Head of Risk & Compliance** (independent control holder).

Management appoints the specific individuals; this document identifies the **roles**, not the people.

## 4. Handling during provisioning (what engineering does)
- `provision.sh` writes init material to a **root-only host file**, never printed. Immediately after setup:
  1. The unseal shares are distributed to the §3 custodians (out-of-band) and the root-only file is **shredded**.
  2. The AppRole SecretID is issued **wrapped**; engineering unwraps once into the API runtime secret and discards
     the wrapping token.
  3. The **root token is revoked**.
- Engineering evidence records only **opaque** facts (health, device active, RoleID length) — never material.

## 5. Recovery / break-glass
- **Restart:** the §3 custodians provide ≥ threshold shares to unseal (pilot) — or auto-unseal handles it (GA).
- **Lost shares:** if fewer than threshold shares survive, the vault cannot be unsealed — restore from a **Raft
  snapshot** into a freshly-initialised instance (new unseal material, re-issued AppRole). This is why snapshot
  custody (§2) is independent.
- **Compromise:** revoke the AppRole SecretID + rotate transit keys + rotate TLS; investigate via the audit log.

## 6. What this establishes / does not establish
- **Establishes:** a concrete, role-based custody model for the pilot, with GA targets, ready to apply when the
  dedicated host is provisioned.
- **Does NOT establish:** appointed custodians (management names them), any deployed instance, or GA auto-unseal.
  No material exists in the repo. No GO; no Tier-2 acceptance; workstreams unchanged.
