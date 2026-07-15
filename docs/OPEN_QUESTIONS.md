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

## AI
10. **Approved AI providers & routing** — which providers are approved for which data classifications (local vs
    cloud), and residency rules. *(Default: no restricted data to any external provider until approved.)*
11. **AI cost/quota budgets per tenant.** *(Default: conservative quotas behind flags during pilot.)*

## Product & operations
12. **MVP tenant, users, and departments** — the exact pilot scope. *(Default: per `docs/02-product/MVP_SCOPE.md`
    and the §53 pilot in the certification report.)*
13. **Support model & SLOs** — support hours, escalation routes, and the SLO targets for critical services.
14. **Data migration sources** — the real source systems, owners, and record volumes for the first tenant's
    migration, plus who provides Finance and Legal migration sign-off.

## Engineering
15. **Rebuild vs. import** — start the GitHub repo from the reference implementation as a validated baseline, or
    re-generate module-by-module through the stage prompts? *(Default: import as a baseline, then validate and
    harden stage-by-stage; see HANDOVER_REPORT.md risks.)*
16. **Hosting & infra target** — cloud provider, orchestration, and IaC toolchain for the environments.
17. **Frontend stack** — no document in `docs/` or `manifests/` names one, so Stage 0 did not invent one:
    `apps/web` is a framework-free TypeScript shell and no bundler is wired up. The choice (framework,
    bundler, component library, and how `SCREEN_CATALOGUE.md` maps onto it) shapes every later UI stage and
    should be decided before Stage 2, when the first screens arrive. *(Default: none — this one genuinely
    needs an owner's decision rather than a default, and it will need an ADR.)*
