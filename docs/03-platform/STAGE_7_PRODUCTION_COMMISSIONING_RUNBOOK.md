# Stage 7 — Production Commissioning Runbook (STAGING → CLEAN PRODUCTION)

> The precise procedure to convert the current Contabo host from **STAGING** to a **CLEAN PRODUCTION
> COMMISSIONING**. It is **reversible until the governed M42 GO** — every step before the GO can be rolled back
> and the host returned to staging. This runbook **executes nothing here**; it is the operator/engineering
> procedure to run **once the prerequisite management decisions and human/external acceptances exist**. It does
> **not** issue a GO, does **not** self-certify Tier-2, and binds no unapproved provider. Kenya-DPA region
> confirmation is a prerequisite before any real data. Baseline: merged `main` `f11c388`.

---

## 0. Preconditions (must ALL be true before commissioning begins)

Commissioning may **not** start until these external/human gates hold (none are satisfiable by automation):

- [ ] **Production hosting/region confirmed** acceptable under **Kenya DPA** by Technology/Risk/Legal (OQ#16).
- [ ] **Secrets provider approved** (STAGE_7_VAULT_DECISION_PACKAGE) + non-prod instance proven in staging.
- [ ] **Off-server backup destination approved** + write-only creds (STAGE_7_OFFSERVER_BACKUP_DR_DECISION_PACKAGE).
- [ ] **External pentest** complete; no open critical/BLOCKER; retest passed; Auditor assurance.
- [ ] **DR drill** passed on the real PG16 stack within RTO≤15/RPO≤5; **COO/Ops acceptance**.
- [ ] **Load/chaos** operational acceptance (COO) against OQ#13 — including a decision on the write-burst signal
      and any capacity remediation from `STAGE_7_CAPACITY_REMEDIATION.md`.
- [ ] **Real-data migration** intake complete (OQ#14: pilot tenant + source named) with **CFO + Legal +
      business-owner** sign-off authorities appointed.
- [ ] Connector production-credential decisions resolved as applicable (OQ#4; internal-first pilot may defer).

> Until §0 holds, this runbook does not run. It describes what to do **when** it holds.

## 1. Commissioning phases (reversible until the GO)

Each phase lists its **rollback** and whether it is reversible. The **point of no return is Phase 12 (M42 GO)**.

| # | Phase | Action | Reversible? | Rollback |
| --- | --- | --- | --- | --- |
| 1 | **Freeze staging** | Announce change-freeze; stop staging load/harness activity; tag the repo state used for prod. | ✅ | Lift freeze |
| 2 | **Archive Tier-2 evidence** | Snapshot all Stage-7 evidence + acceptance pack + sign-offs into the immutable evidence store (read-only). | ✅ | n/a (additive) |
| 3 | **Provision clean prod host/stack** | Stand up production containers on the approved host/region (separate from staging per OQ#16); no synthetic data imported. | ✅ | Tear down prod host |
| 4 | **Fresh production DB/volumes** | Initialise **new** PG16 data volumes; run migrations to head; **no** staging/synthetic rows copied. Remove any synthetic tenants/accounts/`stg-load-*` identities — none exist in a fresh DB by construction. | ✅ | Destroy volumes, re-init |
| 5 | **Fresh production secrets** | Generate new production secrets; **bind the approved secrets provider** (M41 adapter → real provider), replacing `UnavailableSecretProvider`; prove fail-closed→available; zero-secret-value invariant re-checked. | ✅ | Rebind fail-closed default; rotate/destroy issued secrets |
| 6 | **Production domain + TLS** | Point production DNS; issue production TLS; reverse proxy on 443; `NODE_ENV=production` prod guards active (cookie secure/samesite, allowed origins). | ✅ | Revert DNS/TLS |
| 7 | **Firewall validation** | Deny-by-default firewall; only 443 public; DB/vault/SSH private + key/IP-restricted; validate no off-host exposure. | ✅ | Reapply staging firewall |
| 8 | **Off-server backups live** | Enable WAL archiving (`archive_timeout≤60s`) + standby and/or immutable object-store push with write-only creds; run a restore-verify. | ✅ | Disable push; keep on-host backups |
| 9 | **Observability + alerts** | Centralized logs/metrics/traces + alerting (SLO burn, backup failure, replication lag, auth anomalies) wired and firing test alerts. | ✅ | Disable exporters |
| 10 | **Final migration rehearsal** | Rehearse the approved real migration against a **non-production copy/extract**; control totals reconcile; rollback proven. Evidence to CFO/Legal/business. | ✅ | Discard rehearsal DB |
| 11 | **Production migration (staged)** | Execute the approved single-tenant migration into production under maker-checker; control totals reconcile; keep source read-only; **do not** open to users yet. | ✅ (until GO) | **Rollback** to pre-migration snapshot (proven in §10) |
| 12 | **M42 governed GO** | Assemble evidence + all sign-offs; a human issuer (with `platform_certification.control.administer`) runs M42; verdict is **DERIVED** (GO/CONDITIONAL_GO/NO_GO). **Point of no return.** | ❌ (governed) | Pre-GO: full rollback via §11/§4. Post-GO: forward-fix under change control |
| 13 | **Pilot monitoring** | Bounded pilot window; watch SLOs/alerts/backups; hold CONDITIONAL_GO conditions open until discharged. | — | Invoke incident/rollback runbook if breached |

## 2. Reversibility guarantee

Everything up to and including **Phase 11** is reversible: fresh volumes can be destroyed and re-initialised, the
secrets provider can be rebound to the fail-closed default and issued secrets rotated/destroyed, DNS/TLS/firewall
reverted, and the production migration rolled back to a pre-migration snapshot (rehearsed in Phase 10). The commit
point is **Phase 12**, the **M42 governed GO** — a human-issued, immutable, deny-by-default decision (ADR-012). No
automation and no AI may issue it.

## 3. Who does what

- **Engineering/AI (ADR-131):** executes the technical phases (1, 3–11 mechanics), produces evidence. **Never**
  certifies its own work, issues GO, or binds an unapproved provider.
- **COO/Ops, CFO, Legal, business owner, Auditor, Risk, MD/CEO:** the Tier-2 acceptances and the GO
  (see `STAGE_7_TIER2_ACCEPTANCE_PACK.md`).

## 4. What this runbook does NOT do

It does not start commissioning (the §0 gates are not all met), does not issue a GO, does not self-certify Tier-2,
binds no provider, and creates no production credentials. It is the reversible procedure to run once the decisions
and acceptances exist.
