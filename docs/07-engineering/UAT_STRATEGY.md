# UAT Strategy

## Coverage
Platform (login, tenant selection, navigation, roles, permissions, audit, documents, notifications, search,
workflow, rules); operational (feedback, cases, escalations, SLAs, activities); legal (matters, courts, recovery,
documents, legal AI); finance (bank recon, GL recon, journals, approvals, core posting — post-MVP); AI
(operational/legal/finance/copilot); enterprise platform (studio, reporting, marketplace, APIs, webhooks, events,
automation, extensions, tenant admin, billing, branding, mobile, offline, security, GRC).

## Script structure
Each UAT script records: id, requirement, business process, role, tenant, environment, preconditions, test data,
steps, expected result + permissions + audit + event + integration + financial impact, actual result, pass/fail,
defect, evidence, tester, business owner, technical owner, sign-off.

## Acceptance criteria
All critical journeys pass; all finance controls pass; all legal privilege tests pass; tenant isolation passes;
no open critical defects; no unresolved high-risk security defects; business owners sign off; control owners sign
off; migration evidence accepted; operational support ready; training complete.

## Enforcement
A UAT campaign cannot be signed off without complete results, and never with a failed critical journey or an open
critical defect (enforced by the certification module, m42).
