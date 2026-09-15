# Cross-Host DR (G2) + Off-Server Backup (G8) — Execution Evidence

> Execution-status record for gates **G2** (cross-host DR) and **G8** (off-server immutable backup) on candidate
> `dad369e…`. **Not executed.** The operator has **not** supplied the prerequisites, so no DR drill has run.
> **G2/G8 = BLOCKED.** A same-host restore is **never** represented as cross-host DR. No backup key or credential
> appears in this document, logs, Git, or shell history. M42 remains `NO_GO`.

## 1. Prerequisites (operator-supplied) — current status

| Prerequisite | Status |
|---|---|
| Second host in a genuinely different failure domain (different DC) | **NOT SUPPLIED** |
| Immutable off-server storage (Backblaze B2 or equivalent) | **NOT SUPPLIED** (B2 approved in principle; bucket/key not provisioned) |
| Privately-created backup credentials (write-only / least-privilege) | **NOT SUPPLIED** |
| Approved retention + encryption settings | **NOT SUPPLIED** |

**In-place-promotion consequence (already recorded):** the shared staging→production host **cannot be its own DR
host**; G2 requires a genuinely separate second host. This is unchanged.

## 2. Verification battery (to execute only once prerequisites exist)

None of the following has been executed:

- Production-style **encrypted** backup produced.
- **Write-only / least-privilege** backup credentials in use (never exposed).
- **Immutability / retention-lock** verified on the off-server target.
- **Restore onto the second host** (not the primary).
- **Application starts** from restored data.
- **Database integrity + control totals** reconciled.
- **Authentication + tenant isolation** intact post-restore.
- **Primary-host-loss simulation** (failover) executed.
- **Failover + failback** documented.
- **RPO + RTO measured** against targets.
- **Backup-deletion protection** verified.
- **COO/Ops acceptance** recorded.

## 3. What internal tooling already exists (Tier-1, not G2)

Single-host `pg_basebackup` + `pg_verifybackup` + WAL/checksum tooling was previously validated on staging PG16
(recorded in Stage-7 evidence). **This is Tier-1 single-host only and does NOT satisfy G2/G8.** Off-server push and
cross-host restore remain unbuilt.

## 4. Outstanding to close G2/G8

Operator to provision the second host + immutable B2 (write-only key, retention-lock) and privately supply
credentials; then execute the §2 battery and obtain **COO/Ops acceptance**. Backup keys must never be exposed in
output, logs, Git, shell history, or documentation.

## Governance

Execution status only. No DR drill run; same-host restore is not G2. **G2/G8 BLOCKED; M42 `NO_GO`.**
