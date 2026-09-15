# EU Cross-Border Hosting — Final Ruling Evidence (Kenya DPA)

> Final-ruling evidence tracker for hosting Aptic Dynamics production on the Contabo **EU** instance
> `169.58.194.151`. Builds on `EU_HOSTING_SAFEGUARDS_EVIDENCE_PACK.md` (public sources) and
> `PRODUCTION_HOSTING_REGION_RULING_RECORD.md` (decision). **The operator has not yet supplied the confidential
> contractual artefacts, and none of the three reviewers has recorded a decision → the ruling remains PENDING.**
> **EU hosting alone is not approval for real Kenyan customer data.** Confidential contractual documents are **not**
> committed to Git; they are recorded here by **opaque reference, custodian, date and checksum** only. M42 remains
> `NO_GO`.

## 1. Operator evidence-intake checklist (opaque references — NOT the documents themselves)

**Intake status as of `5b27a4a`: NO artefact received.** Do **not** commit the contractual documents. Follow the
evidence-handling protocol in `PRODUCTION_EXTERNAL_GATE_CLOSURE_REPORT.md` §1 — verify completeness + internal
consistency; record date, signer, custodian, version, **SHA-256 checksum**; store the document outside Git; record
only the opaque reference + conclusion below; a typed name is **not** a signature unless governance permits.

| Artefact | Opaque ref | Custodian | Date received | SHA-256 checksum | Status |
|---|---|---|---|---|---|
| Concluded Contabo DPA (Art. 28) | | | | | **NOT SUPPLIED** |
| TOMs annex | | | | | **NOT SUPPLIED** |
| Hosting subprocessor list + locations | | | | | **NOT SUPPLIED** |
| Exact EU country / datacenter confirmation | | | | | **NOT SUPPLIED** |
| Written EU-region pinning confirmation | | | | | **NOT SUPPLIED** |
| Encryption-at-rest commitment / compensating control | | | | | **NOT SUPPLIED** |
| Support + admin-access geography statement | | | | | **NOT SUPPLIED** |
| Deletion-on-termination + data-return terms | | | | | **NOT SUPPLIED** |
| Breach-notification obligations + timelines | | | | | **NOT SUPPLIED** |
| ISO 27001 certificate (or compensating evidence) | | | | | **NOT SUPPLIED** (public status: unverified) |
| SCCs / safeguards for US-parent (KKR) group access | | | | | **NOT SUPPLIED** |
| Backup + DR storage region confirmation (EU) | | | | | **NOT SUPPLIED** |
| Updated DPIA | | | | | **NOT SUPPLIED** |
| Updated Aptic privacy notice (where required) | | | | | **NOT SUPPLIED** |

## 2. Public-evidence baseline (already assembled)

Per `EU_HOSTING_SAFEGUARDS_EVIDENCE_PACK.md`: entity **Contabo GmbH** (Munich, HRB 180722); EU region resolves to
**Lauterbourg, France** (must pin EU; 3/~11 DCs are US); **TLS in transit CONFIRMED**; DPA exists but is concluded
in-panel (text **not public**); subprocessor list / at-rest encryption / support geography / deletion / breach terms
**not public**; ISO 27001 **unverified**; **key residual risk = KKR (US) majority owner → CLOUD-Act / group access**.
These are inputs to — not substitutes for — the committee ruling.

## 3. Required independent decisions (PENDING)

| Reviewer | Role | Decision | Conditions | Signature | Date |
|---|---|---|---|---|---|
| Reuben Mwangi | Legal / Data Protection | ☐ PENDING | | | |
| Njeri Muchina | Head of Risk | ☐ PENDING | | | |
| Kelvin Maina | CTO | ☐ PENDING | | | |

**The ruling is APPROVED only when all three record a decision.** If all three approve, the following is recorded in
`PRODUCTION_HOSTING_REGION_RULING_RECORD.md` §4 with the continuing-safeguards list:

> **APPROVED WITH CONDITIONS:** Hosting Aptic Dynamics on the Contabo EU-region instance may proceed only after the
> listed contractual, technical and organizational cross-border safeguards are evidenced and accepted. This approval
> does not constitute M42 GO or production-cutover authorization.

## 4. Outstanding

Operator to obtain the §1 confidential artefacts from Contabo (chiefly the **in-panel concluded DPA + TOMs**, which
resolve most gaps) and register them by opaque ref/custodian/checksum; then the three reviewers record decisions.
**No approval is recorded here; EU hosting is not automatically compliant; not an M42 GO.**

## Governance

Evidence tracker only. Confidential documents not committed. **Ruling PENDING; M42 `NO_GO`; no real data.**
