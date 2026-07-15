# SaaS Foundation

## Tenancy model
Tenant registry with an organisation hierarchy: tenant → subsidiary → department → branch, plus business units.
Every business record carries `tenant_id`. Tenant-level configuration, workflows, policies, branding, reporting,
and data isolation are all first-class. Subscription readiness (plans/editions/add-ons) exists from day one for
later commercialisation.

## Isolation
RLS FORCE + `tenant_isolation` policies + composite `(tenant_id, id)` keys + composite FKs on every tenant-scoped
table. Access runs inside tenant context (`app.tenant_id`). Global tables are the enumerated exception (tenancy
control plane, audit spine, pre-auth, reference registries).

## Provisioning
Tenant provisioning runs registered provision steps (foundation, security, certification, …) idempotently. Global
templates are provisioned **per tenant** (not via `tenant_id NULL`, which is incompatible with RLS FORCE).

## Reference tables (m01)
tenants, subsidiaries, subscription_plans, tenant_subscriptions, usage_meters (+ hierarchy/branch/department
tables). The first five are legitimately global control-plane tables (non-FORCE).

## Commercialisation readiness
Plans, entitlements, quotas, usage metering, billing, dunning, branding, custom domains, onboarding/offboarding,
retention, and legal-hold-aware deletion are designed in Phase 6F (m39-saas, 72 tables in the reference baseline)
and gated behind the certification + pilot process.
