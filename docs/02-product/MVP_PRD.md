# MVP Product Requirements

## Objective
Prove Finapp Dynamics as one governed, multi-tenant platform by delivering a coherent slice that exercises the
foundation, shared services, two operational modules, the finance reconciliation core (draft-only), a read-only
legal view, basic reporting, and a small set of governed AI summaries — safely, behind feature flags.

## In scope (MVP)
- **SaaS foundation:** tenant registry + hierarchy (subsidiary/department/branch), users, roles, permissions,
  audit, admin console.
- **Shared services:** status, workflow, SLA, timeline, escalation, notifications, documents.
- **Feedback Management:** capture (manual + transaction-triggered), classification/sentiment, negative-feedback
  escalation, HOD review, closure, basic dashboards.
- **Case Management:** creation, assignment, activities (structured + free-text), documents, SLA, escalation,
  closure, audit.
- **Bank + GL Reconciliation:** statement + GL ingestion, rule-based + assisted matching, exception management,
  colour-coded status, reports.
- **Journal Engine (draft-only):** recommendations and drafts routed to approval; **no posting** in MVP.
- **Legal portfolio (read-only):** view matters, deadlines, and documents; no filing automation.
- **Reporting:** role dashboards and core operational/finance reports.
- **Governed AI:** feedback/case summaries, sentiment, reconciliation match suggestions, executive summary — all
  human-reviewed, with confidence + citations.

## Out of scope (post-MVP)
Journal posting to core systems, payments/bank payment initiation, legal filing automation, high-risk recovery
automation, unrestricted public APIs, unrestricted extensions, high-risk offline approvals, autonomous AI
actions, external commercial tenants, and live (non-sandbox) integrations.

## Configurable from day one (even if minimally implemented)
Tenant settings, workflow definitions, rules, notification templates, role/permission assignment, branding, and
feature flags.

## Requires human approval (always)
Journal posting, any payment, legal filing, high-risk approvals, tenant-global and security administration.

## Must not be automated in MVP
Finance posting, payments, legal filing, and any AI-executed controlled action.

## Success criteria
Tenant isolation holds across every module; feedback closes the loop; cases carry both structured and free-text
activity; reconciliation matches are explainable; journals never post without human approval; AI outputs are
labelled, cited, and human-reviewed; every controlled action is audited.
