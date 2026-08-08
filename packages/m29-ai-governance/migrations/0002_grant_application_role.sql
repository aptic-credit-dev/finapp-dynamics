-- ---------------------------------------------------------------------------------------------------
-- M29 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — policy/use_case/release
-- transition by status (ADR-010). Evaluations, decisions, histories and the idempotency ledger are append-only
-- (INSERT+SELECT only). m29 owns NO outbox — it EMITS ai.governance_lifecycle (family owned by m24) through the ONE m06
-- outbox. It has NO grant on any business or m24 table — it governs AI by OPAQUE reference and records decisions/evidence
-- only; it performs NO domain action, NO deployment/runtime control and NO AI self-approval.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_governance_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_governance_use_case TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ai_governance_release TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON ai_governance_evaluation TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_governance_decision TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_governance_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON ai_governance_idempotency TO %I', grantee);
END
$$;
