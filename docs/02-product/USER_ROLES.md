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
| CTO / Technology Lead | Platform engineering leadership; Stage-7 technical execution (DR drill, load/chaos, migration) + remediation | Platform/governance scope (not tenant business); executes but never independently certifies its own hardening condition (SoD); see `docs/03-platform/STAGE_7_HARDENING_GOVERNANCE.md` |
| Head of Risk & Compliance | Risk/compliance assurance; Stage-7 condition accountability (penetration test) + independent assurance | Platform/governance scope (not tenant business); independent of technical execution; not a business approver; see the Stage-7 hardening governance charter |

> The two rows above are **programme-governance (organizational accountability) roles**, ratified per ADR-130 for
> the Stage-7 hardening programme. They are platform/governance scope (like Super Admin), not tenant-scoped business
> approvers, and carry no application RBAC permission grant by virtue of this catalogue entry.

## Rules
Every privileged/controlled action is enforced server-side and audited. Segregation of duties prevents any
identity from both requesting and approving a controlled action. Tenant Admin configures but does not approve
business transactions.
