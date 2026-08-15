-- ---------------------------------------------------------------------------------------------------
-- M40 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — devices/requests/policies/plans
-- transition by status (ADR-010). Offline-evidence, health-signal, backup-run, dr-test, review, history + the idempotency
-- ledger are append-only (INSERT+SELECT only); a terminal restore/failover decision is additionally frozen by its immutability
-- trigger. m40 owns NO outbox — it emits mobile.lifecycle + backup.lifecycle + dr.lifecycle through the ONE m06 outbox, owns NO
-- second scheduler/timer/notification/analytics engine, and executes NO backup/restore/failover directly (framework-only behind
-- a fail-closed port; no shell/dump/restore-command injection). It has NO grant on any other module's table (it consumes
-- m06/m30/m38 BY CONTRACT) and stores NO secret VALUE (config_secret_ref columns are opaque secretref: pointers only; real key
-- management is m41). RTO/RPO/retention are integer; no float.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (a terminal restore/failover is further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_device TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_offline_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_check TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_backup_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_restore_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON resilience_dr_plan TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON resilience_offline_evidence TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_health_signal TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_backup_run TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_dr_test TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON resilience_idempotency TO %I', grantee);
END
$$;
