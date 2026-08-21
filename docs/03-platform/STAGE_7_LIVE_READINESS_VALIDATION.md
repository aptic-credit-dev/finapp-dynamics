# Stage 7 — Live-Readiness Validation Evidence (OpenBao adapter + DR tooling)

> Tier-1 validation under **ADR-131**, executed on the Contabo staging host (`vmi3515072`, PG16.15) against merged
> `main` `5103e05`. It exercises the **actual** OpenBao adapter and the DR tooling end-to-end in a synthetic,
> throwaway, non-production setup. **Real results, nothing fabricated.** No production touch, no approved-instance
> binding, no Tier-2 acceptance, no GO. All proof containers/credentials/temp files were removed after; the staging
> stack was left healthy.

---

## 1. OpenBao adapter — proven against a REAL OpenBao (real TLS)

A throwaway **OpenBao dev-TLS** instance was run on the staging Docker network, configured exactly like the
deployment package (transit engine, AppRole auth, the `finapp-app` least-privilege policy from
`deploy/openbao/policies/finapp-app.hcl`). The **actual adapter source**
(`packages/m41-security/src/providers/openbao.ts`) was then driven through its real `NodeOpenBaoTransport` (real
HTTPS + CA verification) — not the mock. Observed outputs:

| Step | Result |
| --- | --- |
| config load (AppRole, TLS verify on) | `config ok: addr=https://127.0.0.1:8200 auth=approle tlsVerify=true` |
| `provision` | `{"ok":true,"reasonCode":"provisioned","providerRef":"openbao:transit:finapp-secret_proof_tenant_app-db#v1"}` — **opaque ref, no material** |
| `resolveMetadata` | `{"available":true,"reasonCode":"material_available"}` |
| `destroy` | `{"ok":true,"reasonCode":"destroyed"}` |
| `resolveMetadata` after destroy | `{"available":false,"reasonCode":"secret_provider_unavailable"}` — key erased, **fail-closed** |
| `provision` against a dead address | `{"ok":false,"reasonCode":"secret_provider_unavailable"}` — **fail-closed on unreachable host** |
| leak check | providerRef + metadata contain **no** RoleID and **no** SecretID |

**What this establishes:** the adapter authenticates with a machine identity (AppRole), performs transit
provision/resolve/destroy over verified TLS, returns only opaque refs, **fails closed** on both logical (deleted
key) and infrastructure (dead host) errors, and leaks no credential. The **least-privilege policy is correct** —
the AppRole token could do exactly the transit ops needed and nothing else (its success under that policy is the
proof). This is the staging fail-closed→available transition the adapter plan required, minus a management-approved
instance.

**Also validated:** the PURE smoke suite `m41-openbao` (21 assertions, in-process mock) continues to pass; and the
transport now selects `node:http` vs `node:https` by address protocol so the `FINAPP_OPENBAO_ALLOW_HTTP` local-test
path is consistent (HTTPS remains the norm with CA verification).

## 2. DR tooling — validated against the real staging PG16

Using PostgreSQL-native tooling against the running staging PG16 (and isolated throwaway instances), the DR
mechanics were exercised. pgBackRest→B2 adds the off-provider WORM push (needs the B2 account); the underlying
backup/restore/PITR mechanics are proven here:

| Mechanic | Method | Result |
| --- | --- | --- |
| **Base backup + manifest** | `pg_basebackup -X stream --manifest-checksums=SHA256` on staging PG16 | 71 MB backup + 800 KB SHA-256 `backup_manifest` |
| **Checksum verification** | `pg_verifybackup` | **"backup successfully verified"** |
| **Restore / recovery** | started a throwaway PG on the restored copy | recovered + queryable: `tenants=2` (synthetic) |
| **WAL archiving (RPO)** | isolated PG with `archive_mode=on`, `archive_command='cp %p …'`, forced `pg_switch_wal()` | **3 WAL segments archived** (`pg_stat_archiver` archived_count=3) |
| **Backup fail-closed** | `backup.sh` with no B2 creds | refuses: `B2_S3_ENDPOINT not set` (fail-closed) |
| **Failover safety** | `failover.sh promote` with no `PGDATA` | refuses (set -u guard); `help` prints without any destructive default |
| **Script syntax** | `bash -n` on all `deploy/dr/*.sh` + `deploy/openbao/*.sh` | all clean (**one real bug found + fixed** — see §3) |

**What this establishes:** WAL archiving generates archived segments (the RPO/PITR foundation), base backups verify
by SHA-256 checksum, a restored copy recovers to a consistent, queryable state, and the operator scripts fail
closed / refuse unsafe invocations. **What remains** for cross-host DR is the second VPS + the B2 target (RTO
failover + immutable off-provider push) — not validatable without those resources.

## 3. Bug found + fixed during validation

`deploy/dr/standby-bootstrap.sh` had a shell-quoting/heredoc defect (a non-ASCII ellipsis plus an embedded-quote
heredoc body) that failed `bash -n`. Rewritten in pure ASCII without a heredoc; all deploy scripts now pass syntax
checks. This is exactly the value of live validation — a latent script defect caught before any operator ran it.

## 4. What this establishes / does not establish

- **Establishes:** the OpenBao adapter works end-to-end against a real OpenBao over real TLS with the least-privilege
  policy and fails closed; the DR backup/restore/verify/WAL-archive mechanics work on the real PG16; the operator
  scripts are syntactically sound and fail closed; one real script bug was fixed.
- **Does NOT establish:** a management-approved OpenBao instance binding, cross-host DR (needs the 2nd VPS + B2),
  reproducible acceptance-grade performance, or any Tier-2 acceptance. No workstream transitions; CONDITIONAL_GO
  unchanged; no GO. Remaining blockers are external purchases + human acceptance (see
  `STAGE_7_INFRA_PROVISIONING_SPEC.md` and `STAGE_7_MANAGEMENT_PURCHASE_SHEET.md`).
