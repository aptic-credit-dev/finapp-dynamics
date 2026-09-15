# Production External-Gate Closure Report

> Consolidated operator/human action pack to close the outstanding external, human and infrastructure gates for
> candidate `5b27a4a3c76f533ceca0049ec05dd2e91ceaaa6f` (PR #198 merged). **Intake status as of `5b27a4a`: NO
> operator, human, or external evidence has been received.** Every gate therefore remains at its prior status. This
> report neither deploys, changes DNS, processes real data, generates signatures, marks any unexecuted check PASS,
> nor changes M42. **M42 `NO_GO`; 0/12 gates PASS.**

## 1. Evidence-handling protocol (applies to every artefact the operator supplies)

For **every** supplied document or artefact:

1. **Verify completeness and internal consistency** before acceptance.
2. **Record** its date, signer, custodian, version, and **SHA-256 checksum** in the relevant register.
3. **Do not commit confidential contents to Git** — store outside Git; record only an **opaque reference**,
   custodian, date, checksum and conclusion.
4. **Typed names are NOT signatures** unless the approved governance method expressly permits them; absent that,
   a typed name is recorded as **PENDING**, not accepted.
5. **Never invent missing information.** Incomplete or unsigned evidence is classified **PENDING**.
6. **No secret/credential value** (backup keys, OpenBao AppRole/URL/CA, DB passwords, cookies, session ids, real
   PII) enters Git, chat, logs, or command output.

## 2. What each named human / operator must supply

### Workstream 1 — G1 pentest (owner: Head of Risk Njeri Muchina; provider Alex Maunda; auditor Simon Nganga)
- **Alex Maunda:** signed external-status + conflict-of-interest declaration; qualifications + comparable-engagement
  evidence; executed NDA. (`G1_PROVIDER_INDEPENDENCE_DECLARATION.md`)
- **Simon Nganga:** signed Auditor-independence declaration (independent of dev team, Maunda, and the operator).
  (`G1_AUDITOR_INDEPENDENCE_DECLARATION.md`)
- **Njeri Muchina:** verification of the above. **Kelvin Maina:** technical approval.
- **Operator:** approved test window + timezone, source IPs, emergency/stop-test contacts; then provision the
  isolated synthetic target at the exact frozen SHA (separate from production and the shared staging host) and
  **create all credentials privately**.
- **Received: NONE.** 0/13 pre-access conditions met → **G1 BLOCKED**.

### Workstream 2 — EU cross-border ruling (Legal Mwangi · Risk Muchina · CTO Maina)
- **Operator:** the confidential-artefact set in `EU_HOSTING_FINAL_RULING_EVIDENCE.md` §1 (concluded Contabo DPA +
  TOMs first — they resolve most gaps), stored outside Git, registered by opaque ref/custodian/date/checksum.
- **Reuben Mwangi, Njeri Muchina, Kelvin Maina:** three independent recorded decisions.
- **Received: NONE.** → **G9 REQUIRES_REVIEW / ruling PENDING**.

### Workstream 3 — G2/G8 cross-host DR (owner: COO/Ops Samo Nyakuti)
- **Operator:** second host in a **different failure domain**; Backblaze B2 with immutable retention; least-privilege
  write-only backup credentials (private). Then the DR drill + **Samo Nyakuti's** COO/Ops acceptance.
- **Received: NONE.** → **G2/G8 BLOCKED**.

### Workstream 4 — G5 OpenBao (custody group + COO/Ops + Risk)
- **Operator:** dedicated OpenBao host; named primary/secondary custodians; private URL/CA/AppRole; approved
  unseal/recovery process. Production secrets **newly generated privately**; **no staging reuse**.
- **Received: NONE.** → **G5 BLOCKED** (M41 fail-closed).

### Workstream 5 — G4 determination (CFO Patrick Maina · Legal Mwangi · Day-1 business owner · Risk Muchina)
- Signed approval of the **clean-launch N/A** classification for **Aptic Credit Limited** (only if no legacy/real
  data is migrated), or a switch to the full controlled migration rehearsal if any real data must move.
- **Received: NONE.** → **G4 REQUIRES_REVIEW** (proposed N/A; not AI-declarable).

## 3. Current gate status (unchanged from `M42_FINAL_DECISION_PACK.md`)

| Gate | Status | Awaiting |
|---|---|---|
| G1 pentest | **BLOCKED** | signed declarations + isolated instance → test → retest → Auditor attestation |
| G2 cross-host DR | **BLOCKED** | 2nd host + B2 + drill + COO/Ops acceptance |
| G3 load & chaos | **REQUIRES_REVIEW** | dedicated-host re-measure + COO acceptance |
| G4 migration | **REQUIRES_REVIEW** | CFO+Legal+business+Risk N/A approval |
| G5 OpenBao | **BLOCKED** | dedicated host + custodians + bind/verify |
| G6 infra/TLS | **BLOCKED** | prod 443 TLS/HSTS + EU ruling |
| G7 monitoring/IR | **REQUIRES_REVIEW** | wire observability + COO/Ops accept |
| G8 backup | **BLOCKED** | off-server immutable + cross-host restore |
| G9 data protection/EU | **REQUIRES_REVIEW** | DPA/TOMs + 3 signed decisions |
| G10 business acceptance | **REQUIRES_REVIEW** | Aptic Credit Limited owner sign-off (tied G4) |
| G11 support/handover | **REQUIRES_REVIEW** | named roster + COO/Ops accept |
| G12 M42 human decision | **BLOCKED** | Patrick Maina signed decision |

**0/12 PASS. No Critical/High pentest finding exists because no pentest has run. Four non-waivable blockers open.**

## 4. Exact next human decision

Convene the named owners and supply the Workstream-2 **Contabo DPA + TOMs** (unlocks the majority of the EU ruling)
and the Workstream-1 **signed G1 declarations + isolated synthetic instance** (the longest-lead blocker). Until
independent acceptance of all mandatory gates and a signed M42 decision by **Patrick Maina**, production cutover
remains prohibited and requires his explicit `APPROVED — EXECUTE PRODUCTION CUTOVER`.

## Governance

Report + intake pack only. No evidence received this cycle; no status advanced; **M42 `NO_GO`; no deployment.**
