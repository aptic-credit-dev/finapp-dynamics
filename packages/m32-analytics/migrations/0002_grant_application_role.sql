-- ---------------------------------------------------------------------------------------------------
-- M32 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — datasets/metrics/reports/
-- exports/schedules/policies transition by status (ADR-010). Review/materialization/lineage/history + the idempotency
-- ledger are append-only (INSERT+SELECT only); a published metric/report is additionally frozen by its immutability
-- trigger. m32 owns NO outbox/scheduler/notify engine — it emits analytics.lifecycle through the ONE m06 outbox and holds
-- opaque m06 timer + m08 notify references. It has NO grant on any other module's table (it consumes m02/m03/m06/m08/m09/
-- m24/m28/m30 BY CONTRACT/READ PORT) and stores NO secret VALUE and NO float.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (published metric/report further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_dataset TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_metric TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_report TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_export TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_schedule TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON analytics_access_policy TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON analytics_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON analytics_lineage TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON analytics_materialization TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON analytics_definition_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON analytics_idempotency TO %I', grantee);
END
$$;
