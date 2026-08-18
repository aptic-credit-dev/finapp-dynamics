# Stage 7 — Real-Data Migration: Source Intake + Acceptance Checklists (OQ #14)

> **Governance/readiness documentation only.** This prepares the two checklists management must complete before the
> `real_data_migration_execution` workstream may begin and before any migration is accepted. It **invents no real
> source system, no tenant, no record volumes, and no Finance/Legal/business approval.** All real-source and
> sign-off fields are **TBD — HUMAN ACTION**. Preparing these checklists does **not** transition the workstream
> (manifest: `real_data_migration_execution` `requires: [finance_signoff, legal_signoff]`, status
> `requires_review`) and issues no GO. Governing: charter `STAGE_7_HARDENING_GOVERNANCE.md` §2/§5.4, OQ#14,
> ADR-130. The synthetic migration **framework + rehearsal + rollback** already exist and are validated at Tier-1
> (`deploy/staging/migration-*.mjs`); they operate only on synthetic fixtures and are **not** a real migration.

---

## A. Source-intake checklist (management fills BEFORE the workstream may start)

`real_data_migration_execution` may not leave `requires_review` until every row below is TRUE with an approved,
named value. No value here is defaulted or invented.

| # | Intake item | Owner role | Value (repository truth) |
| --- | --- | --- | --- |
| 1 | Pilot tenant named | COO (+ OQ#12) | **TBD** |
| 2 | Source system(s) named | COO / business owner | **TBD** — no system is a confirmed migration source (connectors are integration-only) |
| 3 | Business/system owner (per source) appointed (person) | COO | **TBD** |
| 4 | Data domains in scope | business owner | **TBD** |
| 5 | Record counts by domain | business owner | **TBD** |
| 6 | Extraction method (approved, no live-prod-write) | CTO/Technology Lead | **TBD** |
| 7 | Non-production copy/extract available for rehearsal | CTO/Technology Lead | **TBD** |
| 8 | Privacy / legal basis documented (Kenya DPA; OQ#6/#7) | Legal Officer | **TBD** |
| 9 | Mapping specification owner | CTO/Technology Lead (ratified) | ratified role; spec **TBD** |
| 10 | Reconciliation / control-total owner | COO / Finance | **TBD** |
| 11 | Finance sign-off authority (maker-checker; cannot self-approve) | **CFO** (ratified) | role ratified; **person TBD** |
| 12 | Legal sign-off authority | **Legal Officer** (ratified) | role ratified; **person TBD** |
| 13 | Business-owner sign-off authority | business owner | **TBD** |
| 14 | Final acceptance authority | MD-CEO / Stage-7 committee | ratified; **person TBD** |
| 15 | Rollback owner + approved rollback destination | CTO/Technology Lead | role ratified; plan **TBD** |

**Entry rule:** when #1–#15 are TRUE with approved values, a governance-only PR may transition
`real_data_migration_execution` to the execution-ready status. Until then it stays `requires_review`.

## B. Migration acceptance checklist (evidence required BEFORE acceptance — charter §5.4)

Each item is an **evidence package** recorded against the M42 certification programme as bounded metadata + opaque
references (no raw customer data, no secrets). Acceptance is a governed human sign-off — **never** automated.

| # | Acceptance evidence | Produced by | Accepted/signed by | State |
| --- | --- | --- | --- | --- |
| 1 | Approved source inventory (checklist A complete) | COO + owners | COO | ☐ TBD |
| 2 | Mapping specification (versioned, checksummed, no-eval) | CTO/Tech | Risk/Audit review | ☐ TBD |
| 3 | Data-quality assessment | CTO/Tech | business owner | ☐ TBD |
| 4 | **Rehearsal against a non-production copy** | CTO/Tech | Risk/Audit | ☐ TBD (synthetic rehearsal tooling ready; real rehearsal TBD) |
| 5 | **Control totals reconcile** (in == out, by domain) | CTO/Tech + Finance | **CFO** | ☐ TBD |
| 6 | Exception register (all resolved/accepted) | CTO/Tech | COO | ☐ TBD |
| 7 | Reconciliation report | Finance | **CFO** | ☐ TBD |
| 8 | **Rollback plan proven** (rehearsed, tenant-safe) | CTO/Tech | COO | ☐ TBD (synthetic rollback proven; real-source rollback TBD) |
| 9 | Privacy/security controls (Kenya DPA basis) | Legal | **Legal Officer** | ☐ TBD |
| 10 | **Finance sign-off** (maker-checker; requester ≠ approver) | — | **CFO** | ☐ TBD |
| 11 | **Legal sign-off** | — | **Legal Officer** | ☐ TBD |
| 12 | **Business-owner sign-off** | — | business owner | ☐ TBD |
| 13 | Final migration acceptance | — | MD-CEO / Stage-7 committee | ☐ TBD |

## C. What is technically ready now (Tier-1, synthetic only)

- Versioned, checksummed, no-eval mapping/transform framework: `deploy/staging/migration-mapping.mjs`.
- Sandbox-schema, run-scoped, tenant-safe rollback migration framework: `deploy/staging/migration-framework.mjs`.
- Rehearsal harness + self-test on synthetic fixtures: `deploy/staging/migration-rehearse.mjs`,
  `migration-fixtures.mjs`, `migration-selftest.mjs`.
- Control-total reconciliation and duplicate/natural-key handling validated on synthetic data.

These prove the **mechanism**; they are **not** a real migration and produce **no** acceptance. A real migration
requires checklist A (approved source) then checklist B (evidence + CFO/Legal/business/MD sign-off).

## D. What remains blocked (human/external — not fabricated)

The **actual pilot tenant and source system(s)** (checklist A #1–#2) and every sign-off (B #10–#13) are management/
human decisions not present in repository truth. They are not defaulted, not assumed, and not invented here.
`real_data_migration_execution` stays `requires_review`; no GO is implied.
