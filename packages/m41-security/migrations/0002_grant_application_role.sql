-- ---------------------------------------------------------------------------------------------------
-- M41 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — secrets/keys/policies/controls/
-- classifications transition by status (ADR-010); secure DESTRUCTION is a lifecycle state + future provider-side crypto-erase,
-- while metadata + audit remain auditable (never physically deleted). Reveal, DLP-finding, incident, review, history,
-- assessment, privacy-record + the idempotency ledger are append-only (INSERT+SELECT only); a non-pending secret version is
-- additionally frozen by its immutability trigger. m41 owns NO outbox — it emits the security.* families through the ONE m06
-- outbox, owns NO second RBAC/audit/feature/AI/outbox engine, and executes NO arbitrary code / no crypto command / no provider
-- egress (the real KMS/HSM/Vault is deferred behind a fail-closed port). There is NO secret VALUE / ciphertext / token /
-- private-key / password column anywhere — secret_ref + provider_ref are opaque pointers only.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (a non-pending secret version is further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON security_secret TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON security_secret_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON security_dlp_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON grc_control TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON privacy_classification TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON security_reveal TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON security_dlp_finding TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON security_incident TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON security_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON security_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON security_idempotency TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON grc_assessment TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON privacy_record TO %I', grantee);
END
$$;
