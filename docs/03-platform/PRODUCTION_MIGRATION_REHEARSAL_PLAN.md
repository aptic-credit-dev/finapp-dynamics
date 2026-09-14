# Production Real-Data Migration Rehearsal Plan (G4)

> **PREPARED — NOT EXECUTED / NOT A PRODUCTION GO.**
>
> Final execution pack for the real-data migration rehearsal that discharges production-exit gate **G4**. It
> finalizes — it does not duplicate — the intake and acceptance checklists in
> `STAGE_7_MIGRATION_INTAKE_ACCEPTANCE.md`; the synthetic framework + rehearsal + rollback are already validated
> at Tier-1 (`deploy/staging/migration-*.mjs`). This document **invents no real source system, tenant, record
> volume, or sign-off.** Frozen candidate SHA: `b26d4675fafc9b55b616f41319f191e9f6fb6269`.

---

## 1. Prime directive

**DO NOT access real data without authorization.** No extraction, transfer, or transformation of any real record
may begin until the named source and pilot tenant are approved (§2) and the CFO + Legal + business-owner
authorizations (§3) are recorded. The Tier-1 tooling operates only on synthetic fixtures and is **not** a real
migration.

## 2. Required source + pilot tenant (currently UNNAMED)

| Intake item | Repository truth |
| --- | --- |
| Pilot tenant named | **TBD — HUMAN DECISION REQUIRED** |
| Source system(s) named | **TBD** (connectors are integration-only; none is a confirmed migration source) |
| Business/system owner per source | **TBD** |
| Data domains in scope + record counts | **TBD** |
| Non-production copy/extract for rehearsal | **TBD** |

Status is **BLOCKED** until every row is TRUE with an approved, named value. Naming the source and pilot tenant is
a management decision not present in repository truth.

## 3. Authorization (independent human sign-offs)

| Authority | Role | Independence rule |
| --- | --- | --- |
| **CFO** | Finance sign-off (control totals, reconciliation) | maker-checker: CFO ≠ migration executor (ADR-130) |
| **Legal Officer** | Legal basis / residency (Kenya DPA, OQ#6/#7) | independent of technical execution |
| **Business owner** | Data-scope + reconciliation acceptance | owns the pilot tenant |
| MD-CEO / Stage-7 committee | Final migration acceptance | terminal act |

## 4. Rehearsal procedure (against a non-production copy only)

1. **Approved extraction** — the CTO/Technology Lead performs the approved, non-live-prod-write extraction into a
   non-production copy; no writes to the live source.
2. **Encrypted transfer** — transfer the extract over an encrypted channel to the rehearsal environment; at rest
   under client-side encryption; no plaintext leaves the source host.
3. **Data minimization** — carry only the in-scope domains/fields; drop anything not required for the pilot.
4. **Mapping / transformation** — apply the versioned, checksummed, no-eval mapping
   (`deploy/staging/migration-mapping.mjs`); record the mapping version + checksum.
5. **Load into a sandbox tenant** — run-scoped, tenant-safe, inside tenant context (RLS FORCE).
6. **Control totals** — reconcile `in == out` by domain (counts + monetary totals in minor units; no float).
7. **Rejected-record register** — every rejected/exception row logged with reason; register resolved or accepted.
8. **Reconciliation** — Finance-owned reconciliation report; CFO reviews control totals.
9. **Rollback** — rehearse the tenant-safe rollback to a clean state; confirm the source copy is unchanged.
10. **Deletion / retention evidence** — evidence that the non-production copy and any transient extracts are
    deleted or retained per the approved Kenya-DPA retention basis.

## 5. Acceptance evidence (recorded as bounded metadata + opaque refs — no raw customer data)

| # | Evidence | Accepted / signed by |
| --- | --- | --- |
| 1 | Approved source inventory (intake complete) | COO |
| 2 | Mapping specification (versioned, checksummed, no-eval) | Risk / Audit review |
| 3 | Rehearsal against a non-production copy | Risk / Audit |
| 4 | Control totals reconcile (in == out, by domain) | **CFO** |
| 5 | Rejected-record register (resolved/accepted) | COO |
| 6 | Reconciliation report | **CFO** |
| 7 | Rollback plan proven (rehearsed, tenant-safe) | COO |
| 8 | Privacy/security controls + deletion/retention evidence (Kenya DPA) | **Legal Officer** |
| 9 | Business-owner acceptance of migrated pilot data | business owner |
| 10 | Final migration acceptance | MD-CEO / Stage-7 committee |

## 6. Current status

**BLOCKED + REQUIRES_HUMAN_ACCEPTANCE.** The actual pilot tenant and source system(s) and every sign-off are
management/human decisions not present in repository truth — not defaulted, not assumed, not invented here.
`real_data_migration_execution` (`requires: [finance_signoff, legal_signoff]`) stays `requires_review`. G4 is a
non-waivable release-blocking gate (ADR-133).

## 7. Sign-off

Completed **only after** the source is named, the rehearsal passes on a non-production copy, and the evidence
above exists. Names are never pre-filled.

- CFO (name): ______________________  Signature: ______________________  Date: __________
- Legal Officer (name): ______________________  Signature: ______________________  Date: __________
- Business owner (name): ______________________  Signature: ______________________  Date: __________
- MD-CEO / Stage-7 committee (name): ______________________  Signature: ______________________  Date: __________

---

**Governance: M42 NO_GO; Stage-7 unchanged; no production action.**
