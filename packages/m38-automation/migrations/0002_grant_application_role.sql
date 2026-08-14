-- ---------------------------------------------------------------------------------------------------
-- M38 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — automations/schedules/
-- extensions/installations transition by status (ADR-010). Step/run/review/point/history + the idempotency ledger are
-- append-only (INSERT+SELECT only); an active automation + a published extension are additionally frozen by their immutability
-- triggers. m38 owns NO outbox — it emits automation.lifecycle + extension.lifecycle through the ONE m06 outbox, owns NO
-- second timer/scheduler/workflow/notification/event engine, and executes NO arbitrary code (registered capabilities invoked
-- through owning-module contracts via a fail-closed port). It has NO grant on any other module's table (it consumes m06/m30 +
-- registered capabilities BY CONTRACT) and stores NO secret VALUE (automation_step.config_secret_ref is an opaque secretref:
-- pointer only; real key management is m41). No float; no external network.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (active automation + published extension further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON automation_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON automation_schedule TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON extension_definition TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON extension_installation TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON automation_step TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON automation_run TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON automation_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON automation_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON automation_idempotency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON extension_point TO %I', grantee);
END
$$;
