# Production Executive Action Register — decisions required from Patrick / MD

> The exact set of decisions and authorizations required from the MD (Patrick) to unblock the production exit for
> candidate `b26d4675fafc9b55b616f41319f191e9f6fb6269`. **No approval below is recorded** — every decision field is
> blank until Patrick actually gives it. Recording an approval here is not itself the governance act; the formal
> production authorization is the human M42 decision (`M42_PRODUCTION_DECISION_PACK.md`). M42 remains `NO_GO`;
> Stage-7 G1–G4 unchanged; no production deployment occurred.
>
> **UPDATE — MD authorization received (Patrick Maina).** The decision column below is now filled from the written
> management authorization, recorded verbatim with independence/SoD flags in
> `PRODUCTION_MANAGEMENT_AUTHORIZATION_RECORD.md`. Legend: **✅ decided · ◑ partial/authorized-with-gaps ·
> ☐ outstanding**. This authorization commences readiness work only — it is **not** deployment, DNS, real-data, or
> an M42 change; **no gate is marked PASS** (appointments/authorizations are not evidence acceptance).

| # | Decision required today | Recommended choice (advisory) | Decision owner | Deadline | Impact if not supplied | Evidence produced when completed | Patrick's decision (blank) |
|---|---|---|---|---|---|---|---|
| 1 | Confirm the controlled Day-1 enabled/disabled module scope | Adopt `PRODUCTION_DAY1_MODULE_SCOPE.md` as-is (enabled: M02, M03-auditors, M12, M13, M17 tested-maker, M22 decision-only, M39 admin, M41 secrets read-only; all else disabled) | MD + business owner | Day 1 | No agreed launch surface; cutover cannot be scoped | Signed scope confirmation | ✅ CONFIRMED as-is |
| 2 | Confirm the production hosting region (Kenya-DPA-acceptable) | Contabo region confirmed acceptable by Technology/Risk/Legal (OQ#16) | MD + Legal + Risk + CTO | Day 1 | G6/G9 blocked; no real data permissible; whole cutover stalls | Region ruling record | ◑ intent "host africa"; precise Kenya-DPA residency ruling OUTSTANDING |
| 3 | Appoint gate owners (independence enforced) | COO/Ops, CTO/technical, CFO/migration, Legal/DPO, Head of Risk, independent Auditor, business acceptance owner, incident commander, rollback authority | MD | Day 1 | Gates have no accountable owner; independence (ADR-130) unverifiable | Appointment record (roles → names) | ✅ APPOINTED — see auth record §2 (indep. flags §4) |
| 4 | Authorize the external penetration-test engagement | Engage a qualified independent external provider under NDA/CoI against the isolated staging stack (pack: `PRODUCTION_PENTEST_PROVIDER_PACK.md`) | MD + Head of Risk | Day 1 (long lead) | G1 (non-waivable) cannot start; blocks GO | Signed engagement + provider report + Auditor assurance | ◑ AUTHORIZED (provider Alex Maunda); independence verification pending |
| 5 | Authorize/provide the 2nd DR host + immutable backup storage | Purchase a 2nd Contabo VPS (different DC) + Backblaze B2 (write-only key) | MD + COO + CTO | Day 1 (procurement lead) | G2 + G8 (non-waivable DR) cannot execute | Cross-host DR + off-server restore evidence | ◑ B2 approved; 2nd-host provider/region OUTSTANDING |
| 6 | Authorize/provide the dedicated production OpenBao host | Provision a dedicated OpenBao VPS; deliver URL/CA/AppRole out-of-band (never in chat/repo) | MD + CTO + custody group | Day 1 (procurement lead) | G5 (non-waivable) cannot bind; secrets stay fail-closed | Live-binding evidence + zero-secret-value re-check | ◑ AUTHORIZED; OpenBao host + primary/secondary custodians OUTSTANDING |
| 7 | Name the real-data rehearsal source system + pilot tenant | Name the first pilot tenant + its source system (OQ#14) | MD + CFO + business owner | Day 1 | G4 (non-waivable) is BLOCKED — HUMAN DECISION REQUIRED | Migration rehearsal + reconciliation + CFO/Legal/business sign-off | ☐ BLOCKED — source system + pilot tenant NOT named |
| 8 | Approve the production hostname | Confirm the production DNS name (e.g., app.<domain>) | MD + CTO | Day 1–2 | DNS/TLS provisioning cannot proceed | DNS + TLS records | ✅ hostname `dynamics.finappay.co.ke` approved (DNS change deferred to M42 GO) |
| 9 | Approve the cutover window | A low-traffic maintenance window on Day 4 (subject to gate closure) | MD + COO | Day 3 | No agreed go-live time; comms cannot be issued | Maintenance-window notice | ☐ OUTSTANDING — window not set |
| 10 | Acknowledge M42 remains NO_GO until gate evidence is accepted | Acknowledge; production GO is deny-by-default and human-issued only | MD | Day 1 | Misaligned expectation of an automatic GO | Acknowledgement record | ✅ ACKNOWLEDGED — M42 stays NO_GO until explicit GO |

## Notes
- Items 4–7 are the **four non-waivable release blockers** (external pentest, cross-host DR, production OpenBao,
  real-data migration). None can be risk-accepted away (ADR-133); all require external engagement/purchase or a named
  data source with the required human sign-offs.
- Items 1, 3, 8, 9, 10 are decisions/appointments internal to Aptic; item 2 is a joint Legal/Risk/Tech ruling.
- Claude cannot and will not record any of these as approved. Production cutover proceeds only after the human M42
  decision is recorded and Patrick explicitly instructs "APPROVED — EXECUTE PRODUCTION CUTOVER".
