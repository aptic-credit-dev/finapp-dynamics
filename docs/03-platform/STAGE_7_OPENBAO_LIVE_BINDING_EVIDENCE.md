# Stage 7 — OpenBao Live Provisioning & M41 Binding Evidence

> Tier-1 evidence under **ADR-131**. The **real** `deploy/openbao/` package was provisioned as a **persistent
> Raft + TLS** OpenBao instance and the **actual** M41 `OpenBaoSecretProvider` was bound against it and driven
> through the full fail-closed matrix, a snapshot/restore drill, and observability checks. **Real results, nothing
> fabricated.** All root-token / unseal-key / SecretID / TLS-key material was written only to root-only host files,
> **never printed or committed**, and **shredded after** the validation. No production GO; no Tier-2 acceptance;
> `load_and_chaos_at_scale`/`dr_failover_failback_drill` and the other workstreams are unaffected (see §9). Baseline:
> merged `main` `5ee9e0c`.

---

## 1. Environment & honest scope

- **Host class:** the existing Contabo staging host (12 vCPU / 48 GB). **Limitation:** this validation ran OpenBao
  **co-located** on the app/DB staging host, **not** the production-topology **dedicated separate VPS** (still a
  purchase — `STAGE_7_INFRA_PROVISIONING_SPEC.md` §A). The co-located instance validated the deployment package +
  binding + snapshot/restore; the permanent staging/production instance belongs on the dedicated host.
- **Deployed:** OpenBao **2.6.2**, **Integrated Raft** storage (persistent volume), **TLS** listener.
- **TLS posture:** self-signed CA + server cert (SAN `127.0.0.1`, `aptic-openbao`, `localhost`); the adapter
  connected with **CA verification ON** (`rejectUnauthorized`). Production uses internal PKI / issued certs.
- **Topology:** **single node** (the approved pilot baseline; ADR-132 / procurement plan). **3-node Raft HA is NOT
  claimed** and is the pre-GA baseline.

## 2. Provisioning result (deploy/openbao package)

| Step | Result |
| --- | --- |
| Deploy (compose, Raft, TLS) | container up; `/v1/sys/health` reachable over TLS (CA-verified) |
| Initialise | 5 unseal keys / threshold 3 + root token — written to a **root-only file, never printed**; init recorded |
| Unseal | `sealed=false`; health **200** (unsealed + active) |
| transit engine | enabled |
| least-privilege policy `finapp-app` | uploaded (from `deploy/openbao/policies/finapp-app.hcl`) |
| AppRole `finapp-app` | created (short TTLs); RoleID + SecretID captured to root-only files |
| **Audit device** | **enabled via declarative config** (see §5 finding); `file/` device active; log HMAC-masked |

## 3. M41 live-binding fail-closed matrix (actual adapter vs real OpenBao)

The compiled `packages/m41-security/src/providers/openbao.ts` was driven through its **real** `NodeOpenBaoTransport`
(real HTTPS + CA verification) against the live instance:

| Test | Result | Meaning |
| --- | --- | --- |
| config load | `auth=approle tlsVerify=true` | valid config accepted |
| provision | `{ok:true, providerRef:"openbao:transit:finapp-…#v1"}` | opaque ref, **no material** |
| resolveMetadata | `{available:true}` | material resolvable (metadata only) |
| destroy | `{ok:true, reasonCode:"destroyed"}` | crypto-erase |
| resolve after destroy | `{available:false, secret_provider_unavailable}` | **fail-closed** (key gone) |
| **wrong AppRole SecretID** | `{ok:false, secret_provider_unavailable}` | **fail-closed** on bad credential |
| **TLS verification failure** (CA dropped) | `{ok:false, secret_provider_unavailable}` | **fail-closed** on untrusted cert |
| **provider outage** (dead host) | `{ok:false, secret_provider_unavailable}` | **fail-closed** on unreachable |
| leak check | providerRef contains **no** RoleID / **no** SecretID | no credential leak |

Before availability (no `FINAPP_OPENBAO_*`), `loadOpenBaoConfigFromEnv` returns null → the composition root binds
`UnavailableSecretProvider` (fail-closed) — proven by unit tests and by construction.

## 4. Snapshot / restore drill

| Step | Result |
| --- | --- |
| snapshot save (`operator raft snapshot save`) | **24,092 bytes** |
| mutate after snapshot | created transit key `finapp-postsnap` |
| snapshot restore | health **200** after restore |
| post-restore state | `finapp-postsnap` **gone** (reverted to snapshot); policy `finapp-app` **present**; AppRole **present**; transit mount intact |
| **application re-binding after restore** | provision → `{ok:true, providerRef:"openbao:transit:finapp-…#v1"}`; resolve → available |

Snapshot capture + restore integrity + post-restore policy/AppRole/transit availability + application recovery all
confirmed. (Single-node drill — production HA/DR uses 3-node Raft + off-server snapshot push, not claimed here.)

## 5. Observability

- Health **200**; seal-status `initialized=true sealed=false version=2.6.2`.
- Container `RestartCount=0`, status running; CPU ≈ 2.5%, memory ≈ 46 MiB.
- **Audit log:** ~51.8 KB after the tests; entries are **HMAC-masked** — a grep for the plaintext RoleID returned
  **0** matches (no secret/credential material in the log).
- **No secret value** appeared in adapter output, logs, or evidence — only opaque provider refs + reason codes.

## 6. Deploy-package fixes found by running it live (applied in this PR)

1. **Audit device is config-based** on OpenBao 2.6+ — runtime `bao audit enable` is rejected ("use declarative,
   config-based audit device management"). `config/openbao.hcl` now declares an `audit "file/"` device with
   `type`/`path`/`options` (verified live).
2. **Healthcheck TLS** — `bao status` without the CA fails TLS verification and falsely reports unhealthy. The
   compose healthcheck now sets `BAO_CACERT` and treats "sealed" (exit 2) as process-up.
3. **Raft volume ownership** — the non-root process (uid 100) needs a writable data volume; documented the one-time
   `chown` in `docker-compose.yml` + README (first-create named volumes can be root-owned).

## 7. Remaining production limitations (honest)

- **Not the dedicated host** — co-located validation; the production/staging instance needs the **separate dedicated
  VPS** (purchase).
- **Not HA** — single node; **3-node Raft** required pre-GA.
- **Self-signed TLS** — production needs internal PKI / issued certs.
- **Unseal custody** — validation used a root-only host file (then shredded); production needs **Shamir custody
  (≥3 holders) or transit auto-unseal**, off-host.
- **Off-server snapshot push** — needs the approved immutable store (Backblaze B2; purchase).
- **App composition-root binding** — proven at the adapter level against the real instance; wiring
  `FINAPP_OPENBAO_*` into the running staging API awaits the permanent instance on the dedicated host.

## 8. Evidence references (opaque)
Provider refs are opaque (`openbao:transit:finapp-<sanitized-secretRef>#v<version>`); no secret material, token, or
key is recorded here or anywhere. Init/unseal/SecretID/TLS-key material was root-only on the host during validation
and **shredded** after; the validation instance was **torn down** (host left clean, only the two staging services).

## 9. Workstream / status impact
**None.** Successful OpenBao provisioning is Tier-1 evidence toward the secrets-binding path; it does **not** satisfy
any Stage-7 workstream's exit criteria and does not change `requires_review` on any of the four. It is **not** the
`dr_failover_failback_drill` (that is the PostgreSQL cross-host DR drill). CONDITIONAL_GO unchanged; Stage 8
deferred. No GO. No Tier-2 self-certification.
