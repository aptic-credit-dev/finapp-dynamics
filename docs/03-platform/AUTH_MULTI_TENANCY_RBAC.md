# Authentication, Multi-Tenancy & RBAC

## Authentication (m02)
Login, session management, token expiry + refresh, session revocation, account lockout, dormant-account
detection, service accounts, external/developer users, break-glass + privileged access, and access certification.
Federation/OAuth/OIDC and MFA are readiness with contracts in place. `login_attempts` is pre-authentication and
therefore global (no tenant context yet).

## Multi-tenancy
Tenant resolved into context on every request; all queries run under `app.tenant_id` with RLS FORCE. No tenant
can infer another's existence through counts, timing, errors, or metadata.

## RBAC
Role hierarchy + a permission catalogue (~1,234 permissions in the reference baseline). Scopes: tenant,
subsidiary, branch, department, record ownership, team assignment. Legal ethical walls and finance account
restrictions are enforced. API scopes, connector scopes, event availability, extension permissions, mobile
permissions, export permissions, and AI permissions are all part of the model.

## Enforcement principle
Every privileged/controlled action is enforced server-side; frontend hiding is never authorization. Entitlement
resolution order: tenant active → subscription valid → plan/add-on entitled → capability enabled → feature flag
enabled → user authorized → record authorized → control conditions satisfied.

## Segregation of duties
Maker-checker on controlled actions; no identity both requests and approves. Toxic role combinations are detected
against a seeded SoD catalogue.
