# Stage 7 — Hardening Increment (2026-08-18): authenticated load + Vault/off-server blockers + handoff/intake packages

> Bounded Stage-7 Tier-1 increment under **ADR-131**. **No workstream is transitioned** (all four remain
> `requires_review`); **no Tier-2 acceptance**; **no GO / no CONDITIONAL_GO change** (stays `CONDITIONAL_GO`);
> **Stage 8 stays deferred**. Repository truth governs. Baseline: merged `main` `777ed10` (PR #125). No secrets,
> tokens, keys, or customer data committed.

This increment follows the priority order A–E and records, for each, exactly what was technically executed vs.
what remains a management or independent-human/external gate.

---

## A. Authenticated DB-write load — DONE (Tier-1) ✅

Executed on the Contabo staging PG16 host. Full evidence: `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md`. New assets:
`deploy/staging/seed-login.mjs` (canonical Argon2id credentials via `@finapp/m02-auth`; password via `LOGIN_PW`,
never printed/stored in clear), `deploy/staging/auth-load-harness.mjs` (cookie/session login → authenticated
reads/writes/multi-tenant + negative security matrix), `deploy/staging/auth-load-selftest.mjs`.

- ≈ **860 authenticated identity CREATE writes** to PG16 (all `201`, 0 errors) through auth → RBAC → CSRF →
  audit → outbox → RLS. Reads/mixed/multi-tenant all 0-error.
- **Observed vs approved SLO (informational):** reads/writes/mixed/multi-tenant at 8–12 concurrency **meet**
  p95 ≤ 200 / p99 ≤ 500 / err ≤ 0.5%; a **32-concurrency write burst exceeds** the latency SLOs (single API
  replica + single PG; each write carries audit+outbox) — an honest capacity signal, recorded not accepted.
- Security matrix (authenticated path): unauthenticated → 401, no-CSRF write → 403, unprivileged write → 403.
- Closes the full-stack evidence's "authenticated write not executed" limitation. Operational acceptance is
  COO/Ops (Tier-2) — **not** claimed.

## B. Vault-compatible secrets backend — BLOCKED on an approved provider (recorded, not fabricated) ⛔

Repository truth: the seam already exists and is **fail-closed**. `SecretProviderPort` (`m41-security/src/ports.ts`)
with the default **`UnavailableSecretProvider`** (every op unavailable; no material ever returned; reveal →
`providerUnavailable`) and a deterministic offline `FixtureSecretProvider` test double. **Zero secret-value
columns** is an M41 invariant, guarded by `packages/m41-security/test/m41-security.db-spec.ts` and re-proven on
the Contabo host (`no_production_secrets` = 0). ADR-131 permits a provider-neutral adapter contract + an ephemeral
in-memory staging resolver — **both already present** — but explicitly states *"real production provider binding
stays gated on an APPROVED provider (OQ#10/#16) — a governance amendment cannot approve a provider."*

**Therefore deploying/binding a real Vault-compatible backend is BLOCKED. Nothing further is implementable
without fabricating an unapproved provider binding.** Exact management inputs required (none inventable by
engineering):

1. **Approved specific Vault-compatible product + deployment topology** (self-hosted per ADR-128/OQ#10/#16) —
   product, version, HA/DR model, hosting location (region-confirmed under Kenya DPA before any real secret).
2. **A non-production Vault instance + least-privilege app identity/credentials** delivered out-of-band (never in
   Git/logs/evidence) so the `SecretProviderPort` adapter can be implemented and bound in staging.
3. **Rotation + audit + encrypted-storage + Vault-backup/DR policy** confirmation (ADR-128 controls).

On delivery, engineering (ADR-131) implements the `SecretProviderPort` adapter (opaque `secretref:`/`providerRef`
only; zero secret-value columns preserved; fail-closed on any error) and proves it in staging. Until then M41
stays framework-only and the fail-closed default stands.

## C. Off-server backup / DR copy — BLOCKED on an approved destination (recorded, not fabricated) ⛔

Repository truth: on-host backups exist and are verified (`backups/backup.sh`: `pg_dump -Fc` + SHA-256 verify +
restore-verify (2 tenants) + daily cron 02:30; evidenced in the full-stack doc). The runbook §5 requires **≥ 1
copy logically separated from the production server**. No approved off-server destination or account exists.

**Therefore an off-server copy is BLOCKED. No second host / object-store / credential is inventable here.** Exact
management inputs required:

1. **An approved off-server destination** — a second Contabo host / an S3-compatible object store / an approved
   backup service — with region confirmed under Kenya DPA (staging = synthetic; production = real data).
2. **Least-privilege write-only credentials** for that destination, delivered out-of-band (never committed).
3. **Retention + encryption-in-transit/at-rest + integrity-verification** policy for the off-server copy.

On delivery, engineering adds a fail-closed off-server push of the already-verified, checksummed backup (no new
injection surface; consistent with ADR-127). This is a **prerequisite to `dr_failover_failback_drill`** production
acceptance and to production GO.

## D. External pentest handoff package — DONE (artifact) ✅

`STAGE_7_PENTEST_HANDOFF.md` — provider-facing rules-of-engagement: target env (Contabo staging, now exists),
in-scope, exclusions, test window, emergency contact, evidence-submission requirements, severity rubric
(CVSS v3.1 → M42 severities), retest requirements. **Claude does not conduct or certify the pentest** (ADR-131:
internal automated testing is never the independent external pentest). The workstream stays `requires_review` —
provider engagement, NDA/CoI, formal approvals, and person-appointments are human/external.

## E. OQ#14 migration readiness — DONE (checklists) ✅

`STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md` — the source-intake checklist (15 items management must fill before the
workstream may start) + the migration acceptance checklist (13 evidence items, charter §5.4). **No real source,
tenant, volumes, or CFO/Legal/business approval is fabricated** — all remain `TBD`. The synthetic migration
framework/rehearsal/rollback (already at Tier-1) proves the mechanism only.

---

## Separation of responsibility

### Technical tasks completed by Claude (Tier-1, this increment)
- Seeded canonical synthetic login credentials + tenant memberships (staging only; password never exposed).
- Executed authenticated login + reads + **≈860 DB writes** + multi-tenant concurrency + sustained/burst on real
  PG16; recorded observed vs approved SLOs; ran the authenticated security matrix (401/403/403).
- Fixed a harness CLI-guard defect (importing `load-harness.mjs` no longer triggers its CLI).
- Verified the M41 fail-closed secret seam + zero-secret-value-column invariant on the host.
- Authored: authenticated-load evidence, pentest handoff RoE, migration intake+acceptance checklists, this
  consolidation. Gate-clean (format/lint/build/smoke/PG16); self-tests green.

### Management inputs still required (decisions/credentials — not inventable)
- **B:** approved specific Vault-compatible product + non-prod instance + least-privilege credentials (OQ#10/#16).
- **C:** approved off-server backup destination + write-only credentials + retention/encryption policy.
- **OQ#14:** the real pilot tenant + source system(s) + record volumes; appointment of CFO/Legal/business signers.
- **OQ#4/#16/#6:** connector prod-credential decisions; production hosting/region confirmation under Kenya DPA.
- Production write-concurrency profile (from the first pilot tenant's real volumes) to size the SLO acceptance.

### Independent human / external gates still required (never satisfiable by automation)
- Independent **external penetration test** + Auditor assurance + residual-risk acceptance (D unblocks readiness).
- Independent **DR assurance + COO/Operations acceptance**; **load/chaos operational acceptance** (COO) against
  OQ#13 — including a decision on the 32-concurrency write-burst latency signal.
- **CFO + Legal + business-owner + MD-CEO** sign-offs for the real-data migration.
- The **M42 governed production GO** (ADR-012/129/130; requester ≠ certifier; AI/automation never certify).

**No workstream transitioned. No Tier-2 acceptance. No GO. `CONDITIONAL_GO` unchanged. Stage 8 deferred.**
