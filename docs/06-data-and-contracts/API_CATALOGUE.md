# API Catalogue

All routes under `/api/v1/*`. Every mutating route is an audited endpoint carrying a permission + a registered
audit code. External access goes through the API gateway; integrations through the integration platform.

## Route families (representative)
| Prefix | Module | Purpose |
|---|---|---|
| `/api/v1/tenants`, `/admin` | m01/m04 | tenancy + admin console |
| `/api/v1/auth`, `/users`, `/roles` | m02 | auth, users, RBAC |
| `/api/v1/feedback` | m12 | feedback lifecycle |
| `/api/v1/cases` | m13 | case lifecycle |
| `/api/v1/legal`, `/matters` | m14/m16 | legal + litigation |
| `/api/v1/recovery` | m17 | recovery + enforcement |
| `/api/v1/reconciliation`, `/gl-reconciliation` | m15/m20 | bank + GL recon |
| `/api/v1/journals`, `/approvals` | m21/m22 | journal + approval |
| `/api/v1/ai`, `/copilot` | m24–m28 | governed AI |
| `/api/v1/reports`, `/analytics` | m10/m32 | reporting |
| `/api/v1/integration`, `/connectors`, `/webhooks`, `/events` | m33–m36 | integration platform |
| `/api/v1/automation`, `/extensions` | m38 | scheduler + extensions |
| `/api/v1/security`, `/grc`, `/privacy` | m41 | security control plane |
| `/api/v1/platform-certification` | m42 | certification + release |

## API certification requirements
Ownership, version, authn/authz, tenant resolution, input/output validation, data classification, rate limiting,
quotas, idempotency, pagination, error hygiene (no leakage), logging, audit, OpenAPI, deprecation, tests. Security
tests: BOLA, BFLA, mass assignment, injection, excessive exposure, rate-limit bypass, tenant leakage, replay,
SSRF, auth bypass. The full generated catalogue is produced during Stage 0/1 from route metadata.
