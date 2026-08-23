-- ---------------------------------------------------------------------------------------------------
-- M02 — SELF-ONLY tenant discovery (ADR-134).
--
-- `tenant_memberships` is FORCE ROW LEVEL SECURITY with no system escape (m01/m02 design): a tenant sees
-- its own members and nothing else, and even `withSystem` sees nothing. That correctly prevents member
-- ENUMERATION — but it also blocks the one legitimate self question a signed-in user must answer to use the
-- app: "which tenants may *I* select?".
--
-- This adds the NARROWEST governed capability for exactly that: a SECURITY DEFINER function that returns ONLY
-- the memberships of the identity it is given. It is not a general RLS escape — it reads nothing but active
-- memberships for one identity, exposes no other member, and is callable only by the application role. The
-- ENDPOINT that calls it derives the identity SOLELY from the authenticated session (no client-supplied id),
-- so there is no identity-substitution vector. FORCE RLS on `tenant_memberships` is untouched and stays on.
--
-- Owner/definer must be able to read past FORCE RLS (a BYPASSRLS role). In staging/CI migrations run as the
-- privileged migration role, which satisfies this; production must provision the definer accordingly (ADR-134).
-- ---------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth_self_tenants(p_identity uuid)
  RETURNS TABLE (tenant_id uuid, code text, name text, is_primary boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.tenant_id, t.code, t.legal_name, m.is_primary
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
   WHERE m.identity_id = p_identity      -- self-only: exactly the given identity's memberships
     AND m.status = 'active'             -- inactive/ended memberships are excluded
     AND t.status = 'active'             -- only selectable (active) tenants
   ORDER BY m.is_primary DESC, t.code ASC
$$;

COMMENT ON FUNCTION auth_self_tenants(uuid) IS
  'ADR-134 self-only tenant discovery: active memberships for ONE identity. Not a general RLS escape. '
  'The caller (auth endpoint) must pass the authenticated session identity only — never a client-supplied id.';

-- No ambient access: revoke PUBLIC, grant EXECUTE only to the application role (same grantee model as m01/m02).
REVOKE ALL ON FUNCTION auth_self_tenants(uuid) FROM PUBLIC;
DO $$
DECLARE
  grantee text := COALESCE(NULLIF(current_setting('app.grantee_role', true), ''), 'finapp_app');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS', grantee);
  END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION auth_self_tenants(uuid) TO %I', grantee);
END $$;
