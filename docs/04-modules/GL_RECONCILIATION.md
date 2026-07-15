# GL Reconciliation (m20)

## Purpose
Reconcile general-ledger balances and transactions against source systems, manage exceptions, and feed journal
recommendations. 24 reference tables.

## Capabilities
GL balance + transaction ingestion (upload + API); multi-account; matching against source records; exception
management with colour-coded status; balance certification; journal recommendations; approval workflow; audit-
ready reconciliation reports; exception aging.

## Controls
No reconciliation closure with unresolved required exceptions; journal recommendations are draft-only and routed
to approval; decimal-safe throughout.

## Shared services
Status/workflow (m06), rules (m07), audit, authz, outbox, finance foundation (m19), journal (m21), approval
(m22), finance AI (m27).

## MVP
Ingestion, matching, exceptions, reports; recommendations to draft journals (no posting).
