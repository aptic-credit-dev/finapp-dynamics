# Management Authorization Record — Production Readiness Workstreams

> Faithful record of the written authorization issued by the MD/CEO (**Patrick Maina**) for the Aptic Dynamics
> production-readiness workstreams, against the frozen production candidate
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`.
>
> **What this authorization IS:** approval to *commence readiness work* — appoint owners, procure/provision
> infrastructure, engage the independent pentest, and prepare the migration rehearsal — subject to existing
> security and governance controls.
>
> **What this authorization is NOT** (stated verbatim by the MD): it is **not** permission to deploy production,
> change DNS, process real customer data outside the approved migration rehearsal, or change M42. **M42 remains
> `NO_GO`** until the mandatory gate evidence is accepted and the MD issues the explicit instruction
> *"APPROVED — EXECUTE PRODUCTION CUTOVER."* No gate below is marked PASS; appointments and authorizations are
> **not** acceptance of evidence not yet reviewed (the MD said so explicitly).

## 1. Decisions recorded as given

| # | Item | Decision as authorized | Status |
|---|---|---|---|
| 1 | Controlled Day-1 module scope | **CONFIRMED** as in `PRODUCTION_DAY1_MODULE_SCOPE.md`: enabled = M02, M03 (auditors), M12, M13, M17 (tested maker), M22 (approval-decision), M39 (admin), M41 Secrets (read-only); all else permission- **and** entitlement-disabled | **DECIDED** |
| 2 | Production hostname (proposed) | `dynamics.finappay.co.ke` — **no DNS change until M42 authorizes cutover** | **DECIDED (name); DNS deferred** |
| 3 | Production hosting region | "host africa" (intent) — see §3 **outstanding**: precise Kenya-DPA data-residency ruling still required | **PARTIAL** |
| 4 | Gate owners appointed | See §2 | **DECIDED (see independence flags §4)** |
| 5 | G1 pentest — engage provider | Engagement of **Alex Maunda** authorized; scope = `PRODUCTION_PENTEST_PROVIDER_PACK.md`; critical/high findings resolved **and retested** before production authorization | **AUTHORIZED — pending independence verification (§4)** |
| 6 | G2/G8 — DR + backups | Procurement authorized: second host in a different failure domain (**provider/region not yet named**), **Backblaze B2** (or approved equivalent) immutable off-server storage, cross-host + primary-host-loss drill. No same-host rehearsal may represent the cross-host DR result | **AUTHORIZED — 2nd-host provider OUTSTANDING** |
| 7 | G5 — production OpenBao | Dedicated OpenBao host authorized (**provider/region not yet named**); custodians (**primary/secondary not yet named**); secrets generated + entered privately; **no staging credential/key reuse** | **AUTHORIZED — provider + custodians OUTSTANDING** |
| 8 | G4 — migration rehearsal | Workstream authorized, but **source system and pilot tenant NOT named** (placeholders left blank); CFO + Legal/DPO + business-owner authorization required before any real-data extraction | **BLOCKED — source/tenant not named** |
| 9 | Cutover window | Not set (placeholder left blank) | **OUTSTANDING** |
| 10 | M42 posture | Acknowledged: remains `NO_GO` until evidence accepted + explicit MD instruction | **ACKNOWLEDGED** |

## 2. Appointed gate owners

| Role | Appointee |
|---|---|
| MD/CEO & final M42 authority | Patrick Maina |
| COO / Ops gate owner | Samo Nyakuti |
| CTO / technical owner | Kelvin Maina |
| CFO / migration-control owner | Patrick Maina *(see flag §4.1)* |
| Legal / Data-Protection reviewer | Reuben Mwangi |
| Head of Risk | Njeri Muchina |
| Independent Auditor | Simon Nganga |
| Day-1 business acceptance owner | Maureen Mwaura |
| Incident commander | Cynthia Njambi |
| Rollback authority | Dolly Kawira |

Incident commander (Cynthia Njambi) and rollback authority (Dolly Kawira) are distinct identities — maker/checker
on incident action preserved.

## 3. Outstanding operator inputs (still required to progress)

1. **Precise hosting region / data-residency ruling** — "host africa" is a hosting *intent*, not a Kenya-DPA
   ruling. Before **any real data**, Legal/DPO (Reuben Mwangi) + Head of Risk (Njeri Muchina) + CTO (Kelvin Maina)
   must record the specific region/datacenter and confirm it is Kenya-DPA-acceptable (G6/G9). The `.co.ke`
   hostname implies Kenyan service; residency of the *data at rest* must be ruled explicitly.
2. **Second DR host** — provider + region/failure-domain to be named (G2/G8). Backblaze B2 is approved.
3. **Production OpenBao** — dedicated host provider/region + **named primary/secondary custodians** (G5). Secret
   material entered out-of-band by the operator; never in chat or repo.
4. **Migration source system + pilot tenant** (G4) — **not named**; gate stays BLOCKED — HUMAN DECISION REQUIRED.
5. **Cutover maintenance window** — date/start/timezone (subject to gate closure; DNS unchanged until M42 GO).

## 4. Independence / Segregation-of-Duties flags (surfaced, not waived)

These are controls to preserve, not blockers to the authorization; they require an explicit decision before the
affected gate can be accepted.

1. **CFO/migration-control owner = Patrick Maina = MD/CEO = final M42 authority.** One identity holds the
   migration-control gate **and** issues the terminal production GO. ADR-130 requires the **CFO ≠ migration
   executor**. To keep the control sound: (a) the migration **executor** must be a *different* identity
   (recommend CTO Kelvin Maina executing, CFO Patrick Maina approving control totals); (b) an independent
   reviewer (recommend Head of Risk Njeri Muchina) attests reconciliation/control totals; (c) the concentration
   of migration-ownership + final-GO authority in one person is recorded as an accepted residual by the Head of
   Risk. **Do not let Patrick both execute and approve the migration.**
2. **G1 provider "Alex Maunda" must be verifiably independent and qualified.** Before testing: confirm the
   provider is **external** (not an employee and not any appointed gate owner), capture a signed independence /
   no-conflict-of-interest declaration and qualifications, and confirm the **Auditor (Simon Nganga) is independent
   of the pentester**. The Auditor attests the result; the pentester must not self-attest. If "Alex Maunda" is an
   individual rather than a firm, record the individual's credentials and professional indemnity explicitly.

## 4a. In-place production promotion (infrastructure decision — recorded)

The MD/CEO confirmed an **in-place promotion** infrastructure decision (not an M42 GO, not a cutover
authorization):

- **Domain registrar:** HostAfrica Kenya.
- **DNS / proxy:** Cloudflare (proxies `dynamics.finappay.co.ke`).
- **Production origin:** the existing host **`169.58.194.151`** (currently Stage-7 staging) is **promoted in place**
  to production. Verified provider = **Contabo** (reverse DNS `vmi3515072.contaboserver.net`).
- **Environment model:** after cutover the host **ceases to be staging**; **no separate staging remains** on it.

**Recorded consequences** (detail in `INPLACE_STAGING_TO_PRODUCTION_PROMOTION_PLAN.md`): the production host
**cannot be its own DR host** — a genuinely separate second host is still mandatory for G2, and same-host
backup/restore is **not** G2; the host is **rebuilt, not copied** (fresh prod secrets, clean DB init, staging-secret
rotation, synthetic-data removal); and the **region is EU-CONFIRMED** (Contabo panel: `vmi3515072`, `Cloud VPS 12`,
Running, Region=EU) — **exact country/datacenter not displayed**. The origin is **outside Kenya**, so hosting
Kenyan data is a **cross-border transfer**; **EU hosting is not automatically compliant**. The Kenya-DPA ruling is
**PENDING** with Legal/Risk/CTO (`PRODUCTION_HOSTING_REGION_RULING_RECORD.md`, APPROVED-WITH-CONDITIONS) and is
**not** an M42 GO. **Staging DB audited read-only = synthetic-only** → clean-production initialization, not a G4
migration.

## 5. Governance

Readiness work only. No production deployment; no DNS change; no real customer data outside the approved,
separately-authorized migration rehearsal; **M42 `NO_GO` unchanged**; Stage-7 G1–G4 unchanged. No gate is marked
PASS by this record. Production cutover requires accepted evidence and the MD's explicit
*"APPROVED — EXECUTE PRODUCTION CUTOVER."*
