-- ---------------------------------------------------------------------------------------------------
-- M08 — privileges for the application role. RLS decides WHICH ROWS the role may touch; GRANT decides WHICH
-- VERBS. The role comes from the `app.grantee_role` GUC (else `finapp_app`), is NOLOGIN/NOBYPASSRLS and must
-- not own these tables. NO DELETE is granted anywhere — templates/policies retire by status, requests cancel
-- by status (ADR-010). Delivery attempts are append-only evidence: INSERT + SELECT only, so the delivery
-- record can never be rewritten (ADR-005/041). m08 owns no outbox — it INSERTs into m06's.
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE. Templates/policies retire by status; a PUBLISHED
  -- version's spec is frozen by the service + content_hash, not by revoking UPDATE (activate/retire are
  -- themselves UPDATEs of the status column). Requests advance/lease via UPDATE; inbox rows read/archive via
  -- UPDATE; preferences update in place.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON notification_template TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON notification_template_version TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON notification_request TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON escalation_policy TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON escalation_instance TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON notification_preference TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON inbox_notification TO %I', grantee);

  -- Append-only evidence: INSERT + SELECT only. Delivery attempts cannot be rewritten (ADR-005/041).
  EXECUTE format('GRANT SELECT, INSERT ON notification_delivery TO %I', grantee);
END
$$;
