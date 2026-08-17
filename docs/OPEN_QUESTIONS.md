# Open Questions

These need a decision from a business, security, or engineering owner before or during early development. Each
has a suggested default so work is not blocked; the default should be confirmed, not assumed.

## Commercial & tenancy
1. **First external tenant timing** — after the internal pilot completes its monitoring window? *(Default: yes.)*
2. **Billing provider** — which payment/invoicing provider backs the commercial SaaS billing? *(Default: model
   billing internally; integrate a provider before external GA.)*
3. **Subscription plan taxonomy** — the concrete plan/edition/add-on catalogue for launch. *(Default: define one
   internal plan for the pilot; commercial plans before external tenants.)*

## Integrations
4. **Production credentials & sandboxes** — owner and timeline for real credentials for ERPNext, ApticOne,
   Imarisha, AutoBonds, BimaPro, ApticPay, M-Pesa, and the messaging gateways. *(Default: all connectors remain
   Sandbox/Framework until credentials + a certification pass exist.)*
   *(DECISION 2026-08-17 — INTERNAL-FIRST PILOT: the first pilot is NOT blocked by external connectors. Required for
   pilot = internal platform functionality + email/in-app notifications. Fast-follow after pilot = SMS/WhatsApp.
   Deferred unless the selected pilot explicitly needs it = ApticOne/AutoBonds/BimaPro/ERPNext/ApticPay/M-Pesa and
   bank/core-posting integrations (Later per `docs/02-product/MVP_SCOPE.md`). Production credentials for deferred
   connectors MUST NOT block the first pilot or the Stage-7 pilot-readiness decision; each connector becomes a
   production gate only when explicitly included in the approved pilot/production scope.)*
5. **Core banking / GL posting** — which system receives approved journal postings, and via what contract?
   *(Default: draft-only journals until the posting contract is confirmed and tested.)*

## Security, privacy & compliance
6. **Data residency** — required hosting region(s) and any cross-border transfer constraints. *(Default: Kenya
   region; no cross-border transfer of restricted data without approval.)*
7. **Compliance targets & timeline** — which of ISO 27001 / SOC 2 / GDPR / Kenya DPA are formal goals and when.
   *(Default: Kenya DPA first; others as readiness.)*
8. **Identity provider** — the production IdP / SSO / MFA provider. *(Default: platform-native auth for the
   pilot; federate before external GA.)*
9. **Penetration-test & DR-drill owners** — who executes and signs off these CONDITIONAL-GO conditions.
   *(RESOLVED (roles) — ADR-130 + `docs/03-platform/STAGE_7_HARDENING_GOVERNANCE.md` §1/§3. Pentest: accountable =
   Head of Risk & Compliance, executed by an independent external provider, assured by Auditor, accepted by the
   Stage-7 committee / MD-CEO. DR drill: accountable = COO, executed by CTO/Technology Lead, assured by
   Auditor/Risk, accepted by COO + Operations. Load/chaos: owner/executor = CTO/Technology Lead, assured by
   Auditor/Risk, operational acceptance = COO. Independence preserved (no role executes and certifies its own
   condition). "CTO/Technology Lead" + "Head of Risk & Compliance" are RATIFIED in `USER_ROLES.md` (ADR-130).
   Remaining: appoint persons to the roles.)*

## AI
10. **Approved AI providers & routing** — which providers are approved for which data classifications (local vs
    cloud), and residency rules. *(Default: no restricted data to any external provider until approved.)*
11. **AI cost/quota budgets per tenant.** *(Default: conservative quotas behind flags during pilot.)*

## Product & operations
12. **MVP tenant, users, and departments** — the exact pilot scope. *(Default: per `docs/02-product/MVP_SCOPE.md`
    and the §53 pilot in the certification report.)*
13. **Support model & SLOs** — support hours, escalation routes, and the SLO targets for critical services.
    *(DECISION 2026-08-17 — SLO/RTO/RPO **APPROVED** as the initial Stage-7 operational acceptance thresholds
    (reviewable after the pilot monitoring period): API availability ≥99.9%; p95 ≤200 ms; p99 ≤500 ms; error rate
    (excl. expected 4xx) ≤0.5%; production **RTO ≤15 min**; **RPO ≤5 min**. Initial load validation uses the
    synthetic Tier-1 baseline; the production workload profile is refined from the first pilot tenant's actual
    volumes. These are management-approved targets — automated Tier-1 evidence still does not constitute COO/Ops
    acceptance.)*
14. **Data migration sources** — the real source systems, owners, and record volumes for the first tenant's
    migration, plus who provides Finance and Legal migration sign-off.
    *(Roles RESOLVED — ADR-130 + `docs/03-platform/STAGE_7_HARDENING_GOVERNANCE.md` §2: accountable = COO;
    migration technical owner = CTO/Technology Lead (ratified); **Finance sign-off authority = CFO** (maker-checker,
    cannot self-approve); **Legal sign-off authority = Legal Officer**; final acceptance = MD-CEO / Stage-7
    authority. Candidate-source classification: connectors (ERPNext/ApticOne/Imarisha/AutoBonds/BimaPro/ApticPay/
    M-Pesa/gateways) are integration-only sources; **no system is a confirmed migration source**. The real
    first-tenant source systems + record volumes remain **TBD** — a WORKSTREAM-ENTRY prerequisite for
    `real_data_migration_execution` (it may not commence until an approved source inventory exists), NOT a Stage-7
    entry blocker.)*
    *(DECISION 2026-08-17 — controlled single-tenant migration approach **APPROVED**: one pilot tenant, one approved
    source system, rehearsed first against a non-production copy/extract, control totals must reconcile, rollback
    proven, business-owner + CFO (financial/reconciliation) + Legal (data/privacy basis) sign-off, Risk/Audit review.
    The **actual pilot tenant + source system remain TBD** (to be named separately by management) — OQ#14 stays
    partially open until then.)*

## Engineering
15. **Rebuild vs. import** — start the GitHub repo from the reference implementation as a validated baseline, or
    re-generate module-by-module through the stage prompts? *(Default: import as a baseline, then validate and
    harden stage-by-stage; see HANDOVER_REPORT.md risks.)*
16. **Hosting & infra target** — cloud provider, orchestration, and IaC toolchain for the environments.
    *(Still open. Pentest-scoped decision record — `docs/03-platform/STAGE_7_PENTEST_READINESS.md` §1/§2: the first
    Stage-7 workstream (penetration_test) needs only a **representative staging/test environment** with production
    parity (RLS FORCE active, PG16 schema, synthetic data, connectors mocked/sandboxed, controlled/non-internet
    access) — **not** production hosting. Cloud provider/orchestration/IaC choice remains **TBD** (not invented).
    Environment owner/provisioner = CTO/Technology Lead; readiness approved by Head of Risk & Compliance + Auditor.
    This unblocks the pentest workstream specifically; the broader production hosting/infra decision stays open and
    also gates DR/load-chaos and production GO.)*
    *(DECISION 2026-08-17 — hosting **APPROVED: CONTABO** (kept portable/containerized; no technical lock-in). Docker
    container deployment; **separate** Contabo staging (non-prod) and production servers; **PostgreSQL 16**;
    non-owner/non-superuser `NOBYPASSRLS` app role; **FORCE RLS mandatory**; private-by-default (only required HTTPS
    endpoints public); SSH key-based + IP/VPN-restricted admin access; TLS/HTTPS-only production traffic;
    deny-by-default firewall; automated PostgreSQL backups + periodic snapshots with ≥1 copy logically separated from
    prod; DR sufficient for RTO ≤15 min / RPO ≤5 min; centralized logging/metrics/alerting; **region TBD** pending
    Technology/Risk/Legal confirmation under Kenya DPA before production data; staging = synthetic/non-personal only.
    **Secrets/KMS (per ADR-128):** self-hosted **Vault-compatible** backend behind the M41 `SecretProviderPort`
    (approved in principle; adapter implemented once a specific Vault deployment is approved + available; zero
    plaintext secret columns; least-privilege identity; audit + rotation + encrypted storage + Vault backup/DR).
    Claude/engineering authorized under ADR-131 to deploy + validate the Contabo staging stack ONCE server access is
    provided; it must NOT self-certify Tier-2 acceptance or issue production GO. Deployment runbook:
    `docs/03-platform/STAGE_7_CONTABO_DEPLOYMENT_RUNBOOK.md`.)*
17. **Frontend stack** — no document in `docs/` or `manifests/` names one, so Stage 0 did not invent one:
    `apps/web` is a framework-free TypeScript shell and no bundler is wired up. The choice (framework,
    bundler, component library, and how `SCREEN_CATALOGUE.md` maps onto it) shapes every later UI stage and
    should be decided before Stage 2, when the first screens arrive. *(Default: none — this one genuinely
    needs an owner's decision rather than a default, and it will need an ADR.)*
