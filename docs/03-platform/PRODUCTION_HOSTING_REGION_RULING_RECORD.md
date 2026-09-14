# Hosting-Region Cross-Border Ruling Record (Kenya DPA)

> Formal ruling record for hosting Aptic Dynamics production on the **Contabo EU-region** instance
> (`169.58.194.151`, in-place promotion). **EU hosting is NOT automatically compliant.** This record gates the use
> of any real personal/financial data; it is **not** an M42 GO and does **not** authorize production cutover.
> Sign-offs below are **blank** until the named officers actually record them.

## 1. Operator evidence (authoritative, redacted)

Source: Contabo customer control panel screenshot supplied by the operator. Recorded here **without** account
identifiers, billing details, or credentials:

| Field | Value |
|---|---|
| Instance | `vmi3515072` |
| IP | `169.58.194.151` |
| Product | Cloud VPS 12 |
| Status | Running |
| **Region** | **EU** |

Corroboration: host timezone `Europe/Berlin (+0200)`; reverse DNS `vmi3515072.contaboserver.net` (Contabo).
The screenshot is retained by the operator as the primary artefact; it must **not** be committed with account/billing/credential fields visible.

## 2. Evidence classification

| Item | Result |
|---|---|
| Provider evidence — EU-region confirmation | **PASS** |
| Exact country / datacenter | **NOT SHOWN** |
| Kenya hosting / data residency | **NO — origin is outside Kenya** |
| Cross-border transfer assessment | **REQUIRED** |
| Legal approval | **PENDING** |
| Risk approval | **PENDING** |
| Production authorization | **NOT GRANTED** |
| M42 | **NO_GO** |

## 3. Required confirmations (all must be evidenced and accepted)

The ruling committee — **Legal/DPO Reuben Mwangi, Head of Risk Njeri Muchina, CTO Kelvin Maina** — must confirm,
with evidence, each of the following before any real data is hosted:

1. Lawful basis for the cross-border transfer (Kenya DPA).
2. Appropriate safeguards for the transfer.
3. Contabo data-processing agreement (DPA) in place.
4. Subprocessors and their processing locations.
5. Encryption in transit and at rest.
6. Access and support-location controls.
7. Retention and deletion requirements.
8. Incident / breach notification obligations.
9. Data-subject transparency / privacy-notice updates.
10. Whether a DPIA is required or must be updated.
11. Treatment of sensitive personal data.
12. Backup and DR storage regions (including the off-server B2 region and the second DR host region).

Each item is recorded PASS/FAIL with an evidence reference; any FAIL blocks the use of real data.

| # | Confirmation | Evidence ref | Result (PASS/FAIL) | Confirmed by |
|---|---|---|---|---|
| 1 | Lawful basis for cross-border transfer | | ☐ | |
| 2 | Appropriate safeguards | | ☐ | |
| 3 | Contabo DPA | | ☐ | |
| 4 | Subprocessors + processing locations | | ☐ | |
| 5 | Encryption in transit + at rest | | ☐ | |
| 6 | Access + support-location controls | | ☐ | |
| 7 | Retention + deletion | | ☐ | |
| 8 | Incident/breach notification | | ☐ | |
| 9 | Data-subject transparency / privacy notice | | ☐ | |
| 10 | DPIA required / updated | | ☐ | |
| 11 | Sensitive personal data treatment | | ☐ | |
| 12 | Backup + DR storage regions | | ☐ | |

## 4. Proposed decision wording

> **APPROVED WITH CONDITIONS:** Hosting Aptic Dynamics on the Contabo EU-region instance may proceed only after the
> listed contractual, technical and organizational cross-border safeguards are evidenced and accepted. This approval
> does not constitute M42 GO or production-cutover authorization.

## 5. Sign-off (blank until recorded)

- Legal / DPO — **Reuben Mwangi**: ____________________  Signature: ____________  Date: ________
- Head of Risk — **Njeri Muchina**: ____________________  Signature: ____________  Date: ________
- CTO — **Kelvin Maina**: ____________________  Signature: ____________  Date: ________

## Governance

Cross-border ruling record only. **EU hosting is not automatically compliant.** No real data may be hosted until all
12 confirmations are evidenced and the APPROVED-WITH-CONDITIONS decision is recorded. **M42 `NO_GO`; no production
deployment; no cutover authorization; Stage-7 G1–G4 unchanged.**
