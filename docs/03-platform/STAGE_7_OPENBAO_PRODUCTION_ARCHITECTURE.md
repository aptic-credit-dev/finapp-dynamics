# Stage 7 — OpenBao Production Architecture (Contabo; behind M41 `SecretProviderPort`)

> **Implementation-ready architecture, not a deployment.** OpenBao is the selected secrets-provider target
> (**ADR-132**), behind M41's `SecretProviderPort` (**ADR-128** boundaries unchanged). This document specifies the
> exact topology, hardening, auth, policy, rotation, audit, backup, HA, and recovery for a **future** deployment on
> Contabo. **Nothing here deploys anything, and no token/password/unseal key/private key/secret value is created,
> printed, or committed.** A live instance + credentials are delivered **out-of-band** on approval; production
> binding is gated on the **M42 governed GO**.

---

## 1. Placement & topology (blast-radius isolation)

```
              Contabo private network (deny-by-default firewall; TLS/mTLS only; no public vault port)
  ┌────────────────────────────┐     AppRole/JWT auth (scoped ACL policy)     ┌──────────────────────────────────┐
  │ finapp API (finapp_app)    │ ───────────────────────────────────────────▶│ OpenBao cluster (own host/VM)     │
  │  M41_SECRET_PROVIDER =     │                                              │  • Integrated Raft storage        │
  │   OpenBaoSecretProvider    │◀─────────── opaque providerRef only ─────────│    (3 nodes prod / 1 node staging) │
  │   (adapter; never material)│                                              │  • transit engine (envelope crypto)│
  └────────────────────────────┘                                              │  • KV v2 (versioned secret refs)   │
                                                                              │  • audit device → file/syslog      │
  ┌────────────────────────────┐   read-only replication / backups           │  • ACL policy: one app path only  │
  │ finapp PostgreSQL 16 (prod)│   (SEPARATE host from the vault)             │  • auto-unseal (transit) or Shamir │
  └────────────────────────────┘                                              │  • Raft snapshots → off-server WORM│
                                                                              └──────────────────────────────────┘
```

- **Separate host/VM from the application database** (a DB-host compromise must not also yield the vault, and vice
  versa). Private network only; **no public listener**; only the API and named operators reach the vault API port.
- **Staging vs production are fully separate OpenBao instances** (separate hosts, storage, unseal material, audit
  destinations, policies). The staging instance proves the adapter (ADR-131); it never holds production material.

## 2. Server / container topology & storage

- **Runtime:** OpenBao as a container (or single binary) on a dedicated Contabo VM; non-root; `IPC_LOCK` (mlock) so
  secrets are not swapped to disk (or swap disabled on the host).
- **Storage:** **Integrated Raft** (`raft`) on a dedicated encrypted volume. **Production = 3 nodes** (quorum HA);
  **staging = 1 node** (acceptable, no HA). Raft data dir on its own volume with host-level encryption at rest.
- **Listeners:** one TLS listener on the private interface; client TLS required; optional mTLS for the API client.

## 3. TLS

- Private CA (or approved internal PKI). Vault listener presents a server cert; clients verify the CA.
- Optionally the OpenBao **PKI secrets engine** issues short-lived certs (including, later, DB/mTLS certs).
- TLS material is provisioned out-of-band; **no key or cert private material is committed**.

## 4. Unseal strategy & root-token handling

- **Production auto-unseal via the transit engine of a separate small OpenBao (or Shamir with split key custody).**
  Auto-unseal removes manual unsealing on restart while keeping the unseal key off the node. If Shamir is used,
  **key shares are split among ≥3 custodians** (out-of-band; never on the host, in Git, or in evidence).
- **Root token is generated, used only to bootstrap policies/auth, then REVOKED.** Day-2 operations use
  least-privilege operator identities, never the root token. Emergency re-generation uses the documented
  `operator generate-root` quorum flow.

## 5. Application authentication (machine identity — no static long-lived tokens)

- The API authenticates via **AppRole** (`RoleID` + a short-lived, response-wrapped `SecretID`) or **JWT/OIDC** if a
  workload identity is available — **preferred over any static root/long-lived token**.
- Tokens issued to the API are **short-TTL, renewable, and scoped** by the policy in §6; the adapter renews/re-auths
  and **fails closed** on any auth error (never falls back to a broader identity).

## 6. Least-privilege policies

- One ACL policy grants the API access to **only** its own path(s):
  - `kv/data/finapp/*` — read (and, where the app rotates, create new versions) of its own secret metadata refs;
  - `transit/encrypt/finapp`, `transit/decrypt/finapp`, `transit/rewrap/finapp` — envelope ops on **its** key only;
  - **no** `sys/*`, **no** other app's path, **no** `delete`/`destroy` beyond its own lifecycle needs.
- Operators, backup, and audit each use **separate** identities/policies (SoD). No shared "admin" token.

## 7. Secret paths / namespaces

- Namespace/path convention: `finapp/<env>/<domain>/<name>` (e.g. `kv/finapp/prod/db/app-role`), one transit key
  `transit/keys/finapp-<env>`. Staging and production live in **separate instances** (not merely separate paths).

## 8. Secret rotation & transit usage

- **KV v2 versioning** for secret refs; **transit key rotation** (`transit/keys/finapp/rotate`) with `min_decryption_version`
  advancement; `rewrap` migrates ciphertext to the new key **without** exposing plaintext.
- Where the app stores material, it stores **only the opaque provider ref** (path + version) — never the value. This
  is exactly what `SecretProviderPort` returns and what M41 persists (metadata only).

## 9. Audit devices

- Enable a **file (or syslog) audit device**; OpenBao audit logs **HMAC secret values** (never plaintext). Ship
  audit to the centralized observability sink (separate retention). A missing audit device makes OpenBao **fail
  requests** (fail-closed) — desired.

## 10. Backup / restore

- **Raft snapshots** (`operator raft snapshot`) on a schedule → pushed to the **immutable off-server object store**
  (see `STAGE_7_OFFSERVER_DR_ARCHITECTURE_DECISION.md`), client-side encrypted, write-only credential.
- **Restore** = stand up nodes, `operator raft snapshot restore`, unseal, verify audit + a canary read. Restore is
  **rehearsed** (feeds the DR drill evidence), never assumed.

## 11. HA, failure handling & recovery

- **HA:** 3-node Raft; loss of one node keeps quorum. Health via `sys/health`; a standby auto-promotes on leader
  loss.
- **App-side failure handling:** the adapter treats **any** provider error/timeout/unavailable as **fail-closed**
  (returns `{ ok:false, reasonCode:'secret_provider_unavailable' }`), exactly like the default
  `UnavailableSecretProvider` — the platform degrades safely (no material fabricated) rather than proceeding.
- **DR:** vault snapshot restore + (for the app) the DB DR path are exercised together in the DR drill.

## 12. Staging vs production separation (summary)

| Aspect | Staging OpenBao | Production OpenBao |
| --- | --- | --- |
| Nodes | 1 (no HA) | 3 Raft (quorum HA) |
| Unseal | Shamir (single custodian ok) | transit auto-unseal or Shamir (≥3 custodians) |
| Data | synthetic refs only | real material; region confirmed under Kenya DPA first |
| Purpose | prove the adapter (ADR-131) | serve production, gated on M42 GO |
| Audit/backups | on | on + off-server WORM snapshots |

## 13. Credentials / inputs required AFTER approval (out-of-band; never committed)

1. Approved **topology** (node count, host sizing) + confirmed **region under Kenya DPA** before any real secret.
2. A reachable **staging OpenBao URL** on the private network + its **TLS CA**.
3. The API's **AppRole `RoleID` + wrapped `SecretID`** (or JWT/OIDC config) and the **scoped ACL policy** doc.
4. **Unseal/recovery custody** decision (transit auto-unseal source or Shamir custodians).
5. **Audit destination** + retention; **snapshot schedule** + off-server target.
6. **Rotation policy** (interval; static vs dynamic).

## 14. What this establishes / does not establish

- **Establishes:** an implementation-ready, control-preserving OpenBao architecture and the precise post-approval
  inputs.
- **Does NOT establish:** any deployment, instance, credential, region approval, or binding. M41 stays
  framework-only/fail-closed. Production binding is gated on the **M42 governed GO**. No GO.
