# Production Load & Chaos Acceptance Plan (G3)

> **PREPARED — NOT EXECUTED / NOT A PRODUCTION GO.**
>
> Final acceptance plan for the acceptance-grade load & chaos test that discharges production-exit gate **G3**. It
> finalizes — it does not duplicate — the Tier-1 evidence in `STAGE_7_AUTHENTICATED_LOAD_EVIDENCE.md` and
> `STAGE_7_LOADCHAOS_MULTITENANT_EVIDENCE.md` (and the root-cause analysis in
> `STAGE_7_AUDIT_CHAIN_CONTENTION_ANALYSIS.md`). Frozen candidate SHA:
> `b26d4675fafc9b55b616f41319f191e9f6fb6269`.

---

## 1. Why the existing numbers are not acceptance-grade

The Tier-1 runs executed on the **shared** Contabo staging VPS with run-to-run variance; they are technical
evidence, **not** COO/Ops acceptance. Acceptance-grade numbers require a **dedicated production-like host**
(single tenant of the box, no competing workload) so measurements are reproducible against the SLOs.

## 2. Approved SLOs (OQ#13)

| Metric | Target |
| --- | --- |
| Availability | ≥ 99.9% |
| p95 latency | ≤ 200 ms |
| p99 latency | ≤ 500 ms |
| Platform error rate (excl. expected 4xx) | ≤ 0.5% |
| RTO | ≤ 15 min |
| RPO | ≤ 5 min |

## 3. Workload scope

- **Representative authenticated workload** over **Day-1-ENABLED modules only** (M02/M03/M12/M13/M17/M22/M39/M41
  per `PRODUCTION_DAY1_MODULE_SCOPE.md`) — full path: auth → RBAC → CSRF → service → audit → outbox → RLS.
- Reads, writes, mixed, and multi-tenant concurrency; a **write-burst** profile refined from the first pilot
  tenant's real volumes (OQ#14).
- **No maker/checker finance posting load** — deliberately excluded (AI/automation must never post or approve
  controlled finance actions; the maker/checker-adjacent evidence is the authenticated-write + authz-deny
  matrix).

## 4. Measurements

- Concurrency sweep + write-burst at the target profile; p50/p95/p99, throughput, and error rate beside the SLOs.
- **DB saturation monitoring:** CPU, `pg_locks` (advisory-lock contention), WAL commit, connection-pool
  utilisation — to confirm whether the ceiling is CPU or serialization.
- **Chaos / recovery:** process (container) failure and restart recovery for both API and PostgreSQL; verify
  reconnection to health 200; post-chaos integrity (FORCE-RLS count intact, tenant data intact, audit chain
  gap-free).
- **Alert verification:** confirm SLO-burn, backup-failure, replication-lag, and auth-anomaly alerts actually
  fire under induced conditions (ties to G7).

## 5. The audit-hash-chain write-burst finding (do NOT weaken the control)

Tier-1 established that at 32 concurrent writes the p95/p99 exceed the latency SLOs (error rate stayed 0%). The
precise root cause is that `POST /api/v1/identities` is a **platform-scoped** write whose audit rows append to the
**single PLATFORM audit hash-chain** (`pg_advisory_xact_lock(hashtext('PLATFORM'))`) — a global serialization
point. Distributing across 8 tenants did **not** relieve it (measured: 637 ms single-tenant vs 612 ms across 8
tenants, statistically identical; `distinct advisory-lock objects = 1`).

**This is a deliberate correctness control (the tamper-evident audit spine is one chain) and MUST NOT be weakened
for throughput.** The levers are **capacity and scope**, not the control: validate the real per-tenant business-
write profile (which distributes across per-tenant chains), size the API/DB accordingly, and bound the
platform-scoped write concurrency the design must sustain. Any acceptance must respect the control as-is.

## 6. Forbidden

No destructive load against staging or production. Load runs against the **dedicated production-like host** only;
production-facing infrastructure is never stress-tested. Synthetic non-PII data only until the pilot workload is
authorised.

## 7. Current status

**REQUIRES_HUMAN_ACCEPTANCE (+ partial BLOCKED).** SLOs are approved; Tier-1 evidence exists. Missing:
dedicated-host acceptance-grade re-measure + the capacity/audit-scope sizing decision. Governance permits Tier-1
for pilot **planning only**, "subject to a final acceptance-grade re-measurement on the dedicated production host
before the production GO" (ADR-133). `load_and_chaos_at_scale` stays `requires_review`.

## 8. COO acceptance

The COO accepts operational load & chaos performance against the OQ#13 SLOs **only after** the dedicated-host
re-measure exists and respects the unweakened audit control. Completed by the COO **only after** that evidence
exists — never from shared-VPS Tier-1 numbers.

- COO (name): ______________________  Signature: ______________________  Date: __________
- CTO / execution owner (name): ______________________  Signature: ______________________  Date: __________

---

**Governance: M42 NO_GO; Stage-7 unchanged; no production action.**
