# Production OpenBao Binding (G5) — Execution Evidence

> Execution-status record for gate **G5** (production secrets custody / OpenBao) on candidate `dad369e…`. **Not
> executed.** The operator has **not** supplied the dedicated OpenBao host, custodians, or private connection
> material, so no production binding exists. **G5 = BLOCKED.** M41 secrets provider remains **fail-closed**
> (`UnavailableSecretProvider`). **Zero production secret values** appear in this document, logs, Git, or output.
> M42 remains `NO_GO`.

## 1. Prerequisites (operator-supplied) — current status

| Prerequisite | Status |
|---|---|
| Dedicated OpenBao host | **NOT SUPPLIED** |
| Primary + secondary secret custodians (named) | **NOT SUPPLIED** |
| Private URL / CA / AppRole material (out-of-band) | **NOT SUPPLIED** |
| Approved recovery + unseal process | **NOT SUPPLIED** |

**Live-host observation (read-only, from the shared host audit):** `FINAPP_OPENBAO_ADDR` is **empty** on the running
stack → no vault bound → M41 correctly fail-closed. Adapter + live-binding matrix were previously validated then
torn down (Stage-7 evidence); **no dedicated production OpenBao exists.**

## 2. Verification battery (to execute only once prerequisites exist)

None executed:

- **TLS + CA validation** against the dedicated host.
- **Least-privilege policies** scoped to the app's paths.
- **Application authentication** (AppRole) succeeds.
- **Secret retrieval without plaintext logging** (no value in logs/output).
- **Rotation + revocation** exercised.
- **Restart / recovery** (unseal) exercised.
- **Audit logging** on the OpenBao side.
- **Fail-closed behavior** when OpenBao is unavailable (already the default).
- **Zero production secret values** in Git, reports, or output (re-verified).

## 3. Secret-handling rules (binding)

Production secrets must be **newly generated and entered privately** by the operator. **Never reuse staging
credentials, keys, cookies, or sessions.** No secret value is printed, committed, or logged. Binding occurs at
commissioning, gated on the M42 GO — not in this task.

## 4. Outstanding to close G5

Operator to provision the dedicated OpenBao host, name custodians, and deliver URL/CA/AppRole out-of-band; then
execute the §2 battery and re-verify zero secret-value exposure. Acceptance is via the M42 GO governance path.

## Governance

Execution status only. No binding; secrets fail-closed. **G5 BLOCKED; M42 `NO_GO`.**
