# OpenBao Deployment Package (Aptic Dynamics — Stage-7, ADR-132)

Executable assets to deploy the approved self-hosted secrets backend on Contabo, behind M41's
`SecretProviderPort`. **Nothing here contains a token, unseal key, root token, or secret value.** TLS material,
policies output, and credentials are provided/handled **out-of-band**. Production binding stays gated on the **M42
governed GO**; the API keeps its fail-closed default until `FINAPP_OPENBAO_*` is configured.

## Files
| File | Purpose |
| --- | --- |
| `docker-compose.yml` | OpenBao server (single-node staging; 3-node Raft for prod), IPC_LOCK, TLS, audit volume, healthcheck, private-bound |
| `config/openbao.hcl` | Server config: Raft storage, TLS listener, api/cluster addrs, (prod) transit auto-unseal |
| `policies/finapp-app.hcl` | Least-privilege ACL: transit on `finapp-*` only; deny `sys/*` + `auth/*` |
| `setup.sh` | Post-init: enable transit, install policy, enable AppRole, bind role (short TTLs), enable audit; prints RoleID only |
| `snapshot.sh` | Raft snapshot save/restore + SHA-256 |
| `env.openbao.example` | Placeholder env (copy to `.env.openbao`; never commit real values) |

## Initialization checklist (operator)
1. Provide TLS material into `OPENBAO_TLS_DIR` (`server.crt`, `server.key`, `ca.crt`) — **out-of-band, not committed**.
2. `cp env.openbao.example .env.openbao` and set host paths.
3. `docker compose --env-file .env.openbao up -d`.
4. **Initialise (once):** `bao operator init` — this prints the **unseal keys + initial root token ONCE**. Record
   them **off-host** (Shamir custody ≥3 holders for prod, or transit auto-unseal). **This repo never captures them.**
5. **Unseal** (Shamir) or confirm auto-unseal; `bao status` → unsealed.
6. Export a privileged `BAO_TOKEN` in your shell; run `./setup.sh` (transit + policy + AppRole + audit).
7. Issue a **response-wrapped SecretID** and hand the wrapping token to engineering out-of-band (see `setup.sh`).
8. **Revoke the initial root token** once policies/auth are configured; day-2 ops use scoped identities.
9. Engineering sets `FINAPP_OPENBAO_ADDR/_ROLE_ID/_SECRET_ID/_CA_CERT_PEM` on the API → the
   `OpenBaoSecretProvider` binds automatically (fail-closed until then) and proves the transition in staging.

## Production differences (vs this staging shape)
- **3-node Raft** (quorum HA): unique `node_id` per node + `retry_join` peers in `openbao.hcl`.
- **Auto-unseal via a separate transit vault** (unseal key off-node) — uncomment the `seal "transit"` block.
- **Separate instance** from staging (own host/storage/unseal/audit/policies); real material only after the Kenya-DPA
  region ruling.
- Snapshots (`snapshot.sh`) scheduled → pushed to the immutable off-server WORM target (see `deploy/dr`).

## What is still required (out-of-band; not creatable here)
A reachable OpenBao **host**, **TLS material**, the **RoleID + wrapped SecretID**, and the **unseal custody**
decision. Until those exist, the adapter stays unbound (fail-closed). See `STAGE_7_MANAGEMENT_PURCHASE_SHEET.md`.
