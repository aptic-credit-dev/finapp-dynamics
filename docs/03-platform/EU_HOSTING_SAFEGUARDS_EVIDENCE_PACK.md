# EU Hosting Safeguards — Cross-Border Evidence Pack (Contabo / Kenya DPA)

> Evidence assembled for the 12-point Kenya-DPA cross-border ruling on hosting Aptic Dynamics production on the
> Contabo **EU-region** instance `169.58.194.151` (`vmi3515072`, Cloud VPS 12). **EU hosting is NOT automatically
> compliant.** Findings below cite **authoritative public Contabo sources**; where a term is contractual and not
> public it is marked **NOT PUBLIC — obtain from the concluded DPA/TOMs**. **No contractual term is invented.**
> Decision is **PENDING** the three named reviewers (`PRODUCTION_HOSTING_REGION_RULING_RECORD.md`). This pack is
> **not** an M42 GO and does not authorize production cutover. M42 remains `NO_GO`.

## 0. Material context (read first)

- **Contracting entity:** **Contabo GmbH**, Welfenstrasse 22, 81541 Munich, Germany (District Court München **HRB
  180722**, VAT DE267602842). A group structure exists (Contabo Group GmbH HRB 250961; Contabo Holding GmbH HRB
  280276) — **confirm the exact signing entity on the actual order/DPA.**
- **US parent / third-country access risk (KEY RESIDUAL RISK):** Contabo has been **majority-owned by KKR (US)**
  since June 2022. Even with EU data centers and an EU subsidiary, the **US parent creates potential CLOUD-Act /
  group-level access exposure** that a Kenya-DPA cross-border assessment must weigh.
- **EU region ≠ specific country by default:** selecting region "European Union" currently resolves to Contabo's
  **Lauterbourg (France)** datacenter; Contabo also runs **Munich/Nuremberg (DE)**. **3 of Contabo's ~11 DCs are in
  the US** — the workload **must be explicitly pinned to EU**, which this instance's panel evidence (Region=EU)
  indicates but which the reviewers must re-confirm.
- Contabo itself states residency is *"a necessary but not sufficient condition for GDPR compliance … data
  processing agreements and breach notification procedures are your responsibility."*

## 1. Evidence matrix (source · finding · status · gap · required mitigation)

Status legend: **CONFIRMED** (authoritative public evidence) · **PARTIAL** (partly public; contractual detail
missing) · **NOT PUBLIC** (must be obtained from the concluded DPA/TOMs/panel).

| # | Item | Source | Finding | Status | Gap → required mitigation |
|---|---|---|---|---|---|
| 1 | Contabo contractual entity | About Us; North Data HRB 180722 | Contabo GmbH, Munich (HRB 180722, VAT DE267602842); group entities also exist | **CONFIRMED** | Confirm the **exact signing entity** on the order/DPA |
| 2 | Data Processing Agreement (Art. 28) | help.contabo.com art. 103000274684; euvetted | DPA **exists** but is **not published**; generated + concluded **self-service in the Control Panel** (9-step flow); **not auto-incorporated** | **PARTIAL** | **Conclude the DPA in-panel; obtain the signed PDF** and review clauses before real data |
| 3 | EU processing region | Contabo EU-DC blog; panel evidence Region=EU | EU selectable → **Lauterbourg (France)**; "data stays within EU jurisdiction"; instance panel shows **Region=EU** | **CONFIRMED** | **Re-confirm the instance is pinned to EU** (not a US DC) and record the exact DC in writing |
| 4 | Subprocessors + processing locations | contabo.com/en/legal/privacy/ | Corporate subprocessors listed (Cloudflare, PayPal/Stripe/Skrill, Maxmind, Refinitiv, Personio, MS Ireland, Google Ireland); **no separate hosting-infra subprocessor list** (first-party DCs) | **PARTIAL** | **Obtain the hosting subprocessor list from the DPA;** assess each location |
| 5 | Encryption in transit + at rest | Privacy Policy; Object Storage product | **In transit: TLS — CONFIRMED.** **At rest for VPS volumes: NOT publicly guaranteed** (typically customer-managed, e.g. LUKS) | **PARTIAL** | **Confirm at-rest encryption in the DPA/TOMs;** if not provided, **implement customer-managed disk + backup encryption** (readiness item 14/R3) |
| 6 | Access + support-location controls | About Us; Privacy Policy | Munich HQ, **global operations incl. US**; **no public statement restricting support/admin access to the EU** | **NOT PUBLIC** | **Obtain written support/admin access-geography boundary in the DPA/TOMs;** weigh KKR/US access |
| 7 | Retention + deletion terms | Privacy Policy | Corporate retention stated (6/10 yr legal, 3–10 yr service); **deletion-on-termination of hosted customer data NOT specified publicly** | **PARTIAL** | **Obtain deletion-on-termination + return terms from the DPA** |
| 8 | Breach-notification (Art. 33) | Privacy Policy (silent); EU-DC blog | **No public Art. 33 commitment**; Contabo pushes controller-side duty to customer; processor duty lives in DPA | **NOT PUBLIC** | **Obtain the Art. 28(3)(f)/Art. 33 breach-notification clause + timelines from the DPA** |
| 9 | Privacy-notice implications | contabo.com/en/legal/privacy/ | Contabo = **controller** for its own site data (DPO Dr. Karsten Kinast); **processor** for the hosting service | **CONFIRMED** | **Update Aptic's privacy notice** to disclose Contabo as processor + EU cross-border processing |
| 10 | DPIA implications | EU-DC blog; euvetted | No Contabo DPIA statement (normal for IaaS); risk factors = US parent, unverified certs, at-rest, region-pinning | **CONFIRMED (no statement)** | **Complete/update a DPIA** covering these factors before real data |
| 11 | Technical/organizational security controls (ISO 27001 / TOMs) | euvetted (2026-08-26); datacenters.com; recruiting post | **No verifiable public ISO 27001 / SOC 2 certificate**; some secondary "ISO 27001" claims **unevidenced**; **no public TOMs** | **NOT PUBLIC / UNVERIFIED** | **Obtain the certificate number + TOMs annex from Contabo;** do not rely on marketing claims |
| 12 | Backup + DR storage region | Object Storage blog/help; readiness | Object Storage **S3-compatible, region-selectable**, EU/**Nuremberg** option; **VPS auto-backup add-on region not clearly public** | **PARTIAL** | **Pin B2/object-storage + DR host to EU;** confirm backup add-on region in panel/DPA (ties to G2/G8) |

## 2. Cross-cutting residual risks (for the Risk register)

1. **US parent (KKR) → CLOUD-Act / group-level access** — the dominant cross-border residual; cannot be closed by
   EU region alone. Requires legal safeguards (SCCs/contractual commitments) + a documented risk acceptance.
2. **DPA + TOMs not public** — lawful basis, safeguards, breach terms, deletion, and support-access geography are
   all **contractual and must be obtained** before real data; do not assert them from marketing copy.
3. **ISO 27001 unverified** — treat as claimed-only until a certificate is produced.
4. **Encryption at rest not guaranteed** — plan customer-managed disk + backup encryption regardless.
5. **Region-pinning** — must re-confirm EU pin; avoid the US DCs.

## 3. Decision (PENDING)

The decision remains **PENDING** until all three reviewers record their decision in
`PRODUCTION_HOSTING_REGION_RULING_RECORD.md` §3/§5. **Only if all three approve** is the following recorded, with
every continuing safeguard listed:

> **APPROVED WITH CONDITIONS:** Hosting Aptic Dynamics on the Contabo EU-region instance may proceed only after the
> listed contractual, technical and organizational cross-border safeguards are evidenced and accepted. This approval
> does not constitute M42 GO or production-cutover authorization.

**Continuing safeguards to list on approval (proposed):** concluded DPA + TOMs + subprocessor list on file; EU-region
pin re-confirmed and DC recorded; SCCs / third-country-access safeguards addressing the KKR/US-parent risk;
customer-managed encryption at rest for disk + backups; EU-region backup/object-storage + EU DR host; written
support/admin access-geography boundary; deletion-on-termination terms; breach-notification timelines wired into the
incident runbook; updated privacy notice; completed/updated DPIA; ISO 27001 certificate (or compensating controls).

## 4. Reviewer sign-off (blank until recorded)

Each reviewer records an **independent** decision (APPROVE / APPROVE-WITH-CONDITIONS / REJECT) with conditions:

- **Legal / DPO — Reuben Mwangi:** decision ______________  conditions __________________  Sig ________  Date ____
- **Head of Risk — Njeri Muchina:** decision ______________  conditions __________________  Sig ________  Date ____
- **CTO — Kelvin Maina:** decision ______________  conditions __________________  Sig ________  Date ____

## Sources

- https://contabo.com/en/about-us/ · https://contabo.com/en/legal/privacy/
- https://help.contabo.com/en/support/solutions/articles/103000274684- (DPA via Control Panel)
- https://contabo.com/blog/contabo-eu-data-centers-latency-gdpr/ (EU = Lauterbourg; Art. 28 DPA; residency caveat)
- https://contabo.com/blog/object-storage/ (Object Storage region selection)
- https://euvetted.com/p/contabo (no verified certifications; no public DPA; US-region risk; KKR/CLOUD Act)
- https://www.datacenters.com/providers/contabo-gmbh · https://www.northdata.com/Contabo+GmbH,+M%C3%BCnchen/HRB+180722
- https://mergr.com/kkr-acquires-contabo (KKR majority ownership, June 2022)

## Governance

Evidence pack only. **EU hosting is not automatically compliant.** Decision PENDING three reviewers; no real data
until safeguards evidenced + accepted. **M42 `NO_GO`; no production deployment; no cutover authorization; Stage-7
G1–G4 unchanged.**
