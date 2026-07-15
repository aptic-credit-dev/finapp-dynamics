# Permission Catalogue

~1,234 permissions in the reference baseline, seeded in the identity catalogue (m02). Format:
`module.entity.action` (e.g. `platform_certification.release_decision.issue`). Enforced server-side via the
`AUTHZ` token on every controlled route.

## Structure
- Each module contributes its permission set to the single catalogue.
- Grants: system roles receive module grant-sets; `tenant_admin` typically receives full module grants (never
  business-approval overrides), `auditor` receives read (`*.view`) grants.
- No permission overrides a hard rule (no self-approval, no self-sign-off of one's own assessed domain, immutable
  decisions, no AI-executed controlled actions).

## Scopes layered on top of permissions
Tenant, subsidiary, branch, department, record ownership, team assignment, legal ethical walls, finance account
restrictions, API scopes, connector scopes, extension permissions, mobile permissions, export permissions, AI
permissions.

## With every new module
Add its permissions to the catalogue, wire them to routes, and add the grants — permissions, events, audit codes,
and tests always ship together.
