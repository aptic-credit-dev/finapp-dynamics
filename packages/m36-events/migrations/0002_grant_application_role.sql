-- ---------------------------------------------------------------------------------------------------
-- M36 — privileges for the application role. RLS decides WHICH ROWS; GRANT decides WHICH VERBS. The role comes from
-- `app.grantee_role` (else `finapp_app`), NOLOGIN/NOBYPASSRLS, non-owner. NO DELETE anywhere — endpoints/subscriptions/
-- streams/cursors transition by status (ADR-010). Delivery/review/stream-subscription/history + the idempotency ledger are
-- append-only (INSERT+SELECT only); an approved endpoint is additionally frozen by its immutability trigger. m36 owns NO
-- outbox — it emits webhook.lifecycle + eventstream.lifecycle through the ONE m06 outbox. It has NO grant on any other
-- module's table (it consumes m06 outbox events + m30 secret refs BY CONTRACT) and stores NO secret VALUE (webhook_endpoint
-- holds an opaque secretref: pointer only; real key management is m41). No float (cursor position is bigint); no arbitrary
-- code; no external network (delivery is framework-only behind a fail-closed port).
-- ---------------------------------------------------------------------------------------------------

DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', grantee);

  -- Mutable aggregates: SELECT/INSERT/UPDATE, never DELETE (approved endpoint further frozen by trigger).
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON webhook_endpoint TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON webhook_subscription TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON eventstream_config TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON eventstream_cursor TO %I', grantee);

  -- Append-only evidence + ledgers: INSERT + SELECT only (ADR-005/072).
  EXECUTE format('GRANT SELECT, INSERT ON webhook_delivery TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON webhook_review TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON eventstream_subscription TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON events_history TO %I', grantee);
  EXECUTE format('GRANT SELECT, INSERT ON events_idempotency TO %I', grantee);
END
$$;
