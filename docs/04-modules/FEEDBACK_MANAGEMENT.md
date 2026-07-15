# Feedback Management (m12)

## Purpose
Capture, classify, escalate, resolve, and close customer feedback in a closed loop, with sentiment, root-cause,
and service-quality analytics. 17 reference tables.

## Capabilities
Customer + transaction-triggered feedback; daily service-call capture; client satisfaction scoring;
product/branch/relationship-officer/department-level feedback; positive-feedback closure; negative-feedback
escalation; complaint classification; service-issue tracking; root-cause analysis; escalation to HODs; resolution
+ closure approval; customer follow-up; sentiment analysis; dashboards + management reports.

## Data sources
Manual capture plus API pull from loan/trade-finance/insurance/transaction systems (integration platform).

## Lifecycle
captured → classified → (positive → closed) | (negative → escalated → in_review → resolved → closure_approved →
closed) with customer follow-up. SLA timers + escalation throughout; every step audited.

## Shared services
Status/workflow/SLA/timeline (m06), notifications/escalation (m08), documents (m09), audit (m03), authz (m02),
outbox (m06). Emits feedback lifecycle events consumed by Case.

## MVP
Capture (manual + triggered), classification/sentiment, negative escalation, HOD review, closure, basic
dashboards. Predictive analytics and full omnichannel are post-MVP.
