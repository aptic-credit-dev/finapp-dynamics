# Screen Catalogue

Dashboard-first, role-based landing pages, consistent record header/action bar, status badges, permission guards,
audit + approval history panels, and an AI copilot panel with a mandatory "AI suggestion — human review required"
label. Responsive/tablet-ready; mobile read + low-risk offline capture in MVP.

| Area | Screens |
|---|---|
| Shell | Login, tenant selection, role-aware navigation, notification centre, search, audit view |
| Dashboards | CEO/MD, COO, CFO, Legal, Customer Service, HOD, Branch Manager, Relationship Officer, Finance, Operations, Admin |
| Feedback | Capture, list/filter, detail, escalation, HOD review, closure, feedback analytics |
| Case | Create, list, detail (activities/timeline), documents, escalation, closure |
| Legal (read-only MVP) | Matter portfolio, matter detail, deadlines/calendar, documents |
| Reconciliation | Import (bank/GL), matching workspace, exceptions, split grouping, recon reports, CFO dashboard |
| Journal | Recommendations, draft editor (balanced), approval queue (no post in MVP) |
| AI copilot | Panel per role; summaries with confidence + citations; review controls |
| Admin | Tenant, subsidiary, department, branch, users, roles, permissions, workflow config, rules, notification templates, branding, feature flags |
| Reports | Report catalogue, dashboards, exports (RLS + masking) |

## UX principles
Clarity over density; explicit states (loading/blocked/failed/conditional/unauthorized); role visibility encodes
intent (hidden vs disabled-with-reason vs read-only); every controlled action shows its audit trail; AI output is
always labelled and never presented as an authoritative record.
