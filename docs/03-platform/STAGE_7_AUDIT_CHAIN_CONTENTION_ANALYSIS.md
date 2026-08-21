# Stage 7 — Audit-Chain Advisory-Lock Contention Analysis (do NOT weaken tamper-evidence)

> Analysis of whether the M03 audit hash-chain's per-scope advisory lock
> (`pg_advisory_xact_lock(hashtext(scope_key))`, `packages/m03-audit/src/repository.ts:112`) — identified in
> `STAGE_7_CAPACITY_RETEST_EVIDENCE.md` as the 32-concurrency write-burst bottleneck — can be **safely** reduced.
> **Conclusion: the lock is ALREADY at the correct (per-tenant) granularity; it is RETAINED unchanged.** The
> measured contention was an artefact of a synthetic load concentrated in one/two tenants. Repository invariants
> (tamper-evidence, deterministic ordering, tenant isolation, transaction integrity, canonical audit ownership)
> **override** any throughput goal. No audit code is changed by this analysis.

---

## 1. What the lock actually protects (repository truth)

`AuditRepository.nextChainLink(tx, scopeKey)` takes a transaction-scoped advisory lock keyed on `scope_key`, then
reads the current tail (`max(seq)`, `event_hash`) so the appended row's `previous_event_hash` genuinely names the
row before it and `seq` is gap-free. The lock is held to end-of-transaction, so the audit row commits atomically
with the business change it describes. This is the **tamper-evident hash-chain**: any reordering, gap, or dropped
link is detectable on verification (`scopeChain`).

**Crucially, `scope_key` is already the tenant boundary.** The class comment states "two concurrent writers to the
same scope (a tenant, or PLATFORM) serialise", the query filters `scope_key = 'PLATFORM'` for platform events, and
tenant events use the tenant as scope. So the serialization domain is **one chain per tenant** (plus one PLATFORM
chain) — not a global lock.

## 2. Why the retest showed heavy contention (measurement artefact)

The retest drove **32 concurrent authenticated writes into one/two synthetic tenants**. Because the chain is
per-tenant, all 32 writers contended the **same** tenant's advisory lock — by construction. In production, write
load is spread across **many** tenants, and cross-tenant writes **do not** contend (different `scope_key` →
different advisory key). So the observed ceiling is the **per-tenant** serial-append rate, hit here only because the
load was single-tenant. This reframes the finding: it is not a global throughput wall; it is the **per-tenant audit
append rate**, which is an intended property of a per-tenant tamper-evident ledger.

## 3. Could the scope be reduced further? (each option assessed against the invariants)

| Option | Preserves tamper-evidence? | Preserves deterministic order? | Verdict |
| --- | --- | --- | --- |
| **Keep per-tenant scope (current)** | ✅ one verifiable chain per tenant | ✅ gap-free `seq` per tenant | **RETAIN** — correct granularity |
| Per-(tenant × stream/partition) sub-chains | ⚠️ only if verification is redefined over N sub-chains AND a deterministic merge/order is specified | ⚠️ ordering becomes per-partition, not per-tenant | **Not now** — changes the audit contract; needs an ADR + equivalence proof |
| Append-sequencing via a DB sequence (no advisory lock) | ❌ a sequence gives unique `seq` but NOT a hash-linked tail read under a lock — concurrent appenders can still race `previous_event_hash` | ❌ | **Rejected** — breaks the chain link |
| Asynchronous / deferred chaining | ❌ the chain would not commit atomically with the business change; a crash between could orphan/replay links | ❌ | **Rejected** — breaks atomic tamper-evidence |
| Coarsen (global lock) | — | — | **Rejected** — worse, and cross-tenant coupling |

**The only option that could raise per-tenant throughput without obviously breaking integrity is per-partition
sub-chains** — splitting a tenant's single chain into K independent hash-chains (e.g. by module or a hash bucket).
But that **changes the audit model**: verification must then check K chains, "the tenant's audit history" is no
longer a single total order, and a cross-partition ordering guarantee (if any is relied upon) must be re-specified.
That is a governance/design decision with a real correctness surface — **not** a tuning change, and **not** clearly
valid without proof. Per the prompt's own rule ("if correctness cannot be preserved, retain the lock and treat it
as an architectural throughput ceiling"), it is **not** implemented here.

## 4. Decision

- **RETAIN** the current per-tenant advisory-lock chain unchanged. It is the correct tamper-evidence granularity;
  the per-tenant serial-append rate is a **deliberate architectural throughput ceiling**, not a defect.
- **Do NOT** implement per-partition sub-chains in this increment. If a single tenant is ever shown (on real,
  reproducible measurement — not shared-VPS noise) to need write concurrency beyond one serial chain, that is the
  trigger to open a dedicated **ADR proposing partitioned per-tenant sub-chains** with: (a) a redefined verification
  procedure over sub-chains, (b) a specified ordering/merge guarantee, (c) an equivalence proof that tamper-evidence
  and tenant isolation are preserved, and (d) a staging proof. Until then, the current design stands.
- **Capacity, not code:** if aggregate audited-write throughput must rise, scale by **spreading load across tenants**
  and by **DB tuning** (shorten the critical section: larger `shared_buffers`, faster WAL/commit) and horizontal
  read/replica capacity — none of which touches the audit serialization. `synchronous_commit` stays `on`
  (finance/audit durability); it is **not** weakened for throughput.

## 5. What this establishes / does not establish

- **Establishes:** the advisory lock is already tenant-scoped (correct); the retest contention was a single-tenant
  load artefact; reducing scope further changes the audit contract and is deferred to a future proven ADR; the lock
  is retained; the per-tenant append rate is an accepted ceiling.
- **Does NOT establish:** any change to audit behaviour, any weakening of tamper-evidence/ordering/isolation, or an
  accepted production throughput number (re-measure per-tenant on the dedicated prod host).
  `load_and_chaos_at_scale` stays `requires_review`. No GO.
