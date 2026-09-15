# G4 — Real-Data Migration or N/A Determination

> Determination record for gate **G4** on candidate `dad369e…`. Intended Day-1 pilot tenant = **Aptic Credit
> Limited**. This document **proposes** a classification and assembles its supporting controls; it does **not**
> declare G4 N/A. **Only the named human authorities (CFO, Legal/DPO, business owner, Head of Risk) may approve the
> classification.** No real customer data is extracted, copied, or processed in this task. M42 remains `NO_GO`.

## 1. Question

Does the Day-1 launch for **Aptic Credit Limited** require migration of legacy / real customer data, or does
production start from a **clean database** with no migrated real data?

## 2. Evidence bearing on the determination

- The Day-1 plan (`INPLACE_STAGING_TO_PRODUCTION_PROMOTION_PLAN.md` Phase 5) is **clean-production initialization**:
  a fresh production DB (84 migrations applied clean), production tenant + first admin created via a **private
  operator procedure**, retaining only approved reference/config data.
- The current staging DB was audited read-only = **synthetic-only** (8 `stg_tenant_*`; `staging.local` /
  `synthetic.staging` emails) and is **discarded**, not promoted.
- Therefore, **as planned, Day-1 contains no migrated real data.**

## 3. Proposed classification (PENDING human approval)

**PROPOSED: G4 NOT_APPLICABLE for Day-1** — production starts from a clean database; no legacy/real data is migrated
for launch. This is a **proposal for the named authorities to approve**, not a self-declaration.

### 3a. If N/A is approved — required controls (to evidence)

- **Clean-production initialization controls:** fresh DB; non-superuser `finapp_app`; FORCE RLS; production tenant +
  first admin via private operator procedure (Claude creates no password).
- **Synthetic-data disposal evidence:** pre-removal encrypted dump reference + row-count snapshot + drop
  confirmation for `finapp_staging` (recorded, no PII).
- **No real data** enters production until/unless a separate, authorized migration occurs.

### 3b. If real data WILL be migrated (alternative path)

Then G4 is **required**, not N/A: name the source system; minimize + encrypt the extract; run a **production-like
rehearsal outside production**; reconcile approved **control totals**; test **rollback**; obtain CFO + Legal/DPO +
business-owner acceptance. **No real customer data may be extracted, copied, or processed without those
authorizations.**

## 4. Required approvals (PENDING — none recorded)

| Authority | Role | Decision (N/A ✔ / migration required) | Signature | Date |
|---|---|---|---|---|
| _(CFO)_ | Finance / migration control | ☐ PENDING | | |
| Reuben Mwangi | Legal / Data Protection | ☐ PENDING | | |
| _(business owner — Aptic Credit Limited)_ | Business acceptance | ☐ PENDING | | |
| Njeri Muchina | Head of Risk | ☐ PENDING | | |

> Note: the CFO/migration-control owner was recorded as **Patrick Maina**; per the independence flag
> (`PRODUCTION_MANAGEMENT_AUTHORIZATION_RECORD.md` §4.1) the migration **executor** must differ from the approver,
> and the final-GO authority overlap must be an accepted, recorded residual. The business-owner appointee for Aptic
> Credit Limited is to be named.

## 5. Determination status

**PENDING — HUMAN DECISION REQUIRED.** Claude does not unilaterally declare G4 N/A. Until the authorities above sign,
G4 is **BLOCKED / REQUIRES_REVIEW**.

## Governance

Determination record only. No real data touched. **G4 not approved N/A by AI; M42 `NO_GO`.**
