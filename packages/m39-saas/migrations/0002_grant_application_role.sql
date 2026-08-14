-- ---------------------------------------------------------------------------------------------------
-- M39 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — plans/subscriptions/billing
-- transition by status (ADR-010). Plan-entitlement, quota-policy, entitlement-assignment, override, usage-event, review,
-- history + the idempotency ledger are append-only (INSERT+SELECT only); a published plan version is additionally frozen by
-- its immutability trigger; the race-safe quota counter is a mutable aggregate (UPDATE, bounded by its reserved<=limit CHECK).
-- m39 owns NO outbox — it emits subscription.lifecycle + usage.lifecycle + billing.lifecycle through the ONE m06 outbox, owns
-- NO second tenancy/RBAC/feature/analytics/quota/outbox engine, posts NO journal and creates NO payment (finance consumed BY
-- CONTRACT; the billing provider is deferred behind a fail-closed port). It has NO grant on any other module's table and stores
-- NO secret VALUE. Money is bigint minor units; no float.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published plan version further frozen by trigger; the quota
  -- counter is bounded by its reserved<=limit CHECK).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON saas_plan TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON saas_plan_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON saas_subscription TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON saas_quota_period TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON saas_billing_cycle TO %I', grantee);

  -- Append-only catalogue/evidence/ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON saas_plan_entitlement TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_quota_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_entitlement_assignment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_override TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_usage_event TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON saas_idempotency TO %I', grantee);
END
$$;
