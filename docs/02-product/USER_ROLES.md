# User Roles

Roles are tenant-scoped; permissions are enforced server-side. Frontend hiding is never authorization.

| Role | Primary responsibilities | Key constraints |
|---|---|---|
| Super Admin | Platform-level administration (cross-tenant, provider) | Not a business approver |
| Tenant Admin | Tenant configuration, users, roles, branding | Zero business approvals; SoD enforced |
| MD / CEO | Executive visibility, executive copilot | Read-focused; approvals only where defined |
| COO | Operational oversight, escalations | — |
| CFO | Finance oversight, reconciliation/journal approvals | Maker-checker; cannot self-approve |
| Legal Officer | Matters, litigation, recovery, legal docs | Privilege + ethical walls |
| Customer Service Officer | Feedback capture, complaint handling | — |
| Head of Department | Review + closure of escalated items | — |
| Branch Manager | Branch-level operations + visibility | Branch scope |
| Relationship Officer | Customer feedback, case activity | Record ownership |
| Finance Officer | Reconciliation, journal drafting | Maker only where SoD applies |
| Operations Officer | Operational records, exceptions | — |
| External Advocate | Assigned legal matters only | Restricted, matter-scoped |
| Auditor | Read-only across audit/evidence | No mutation |
| Read-only Executive Viewer | Dashboards + reports | Read-only |

## Rules
Every privileged/controlled action is enforced server-side and audited. Segregation of duties prevents any
identity from both requesting and approving a controlled action. Tenant Admin configures but does not approve
business transactions.
