# Bank Reconciliation (m15 + m15a matching)

## Purpose
Match bank statement items against GL/transaction records at high volume, with a configurable matching engine,
exception management, and audit-ready reports. 18 reference tables.

## Capabilities
Bank statement ingestion (CSV/Excel/PDF); GL upload + API pull; multi-bank/account/branch; exact/probable/split
matching; 1:1, 1:many, many:1, many:many; unmatched-item management; manual ticking + grouping of split items;
rule-based engine + AI-assisted classification + match suggestions; colour-coded status (dark-green exact matched,
light-green strong probable, amber partial/uncertain, orange review, red unmatched, plus reserved escalated tone);
exception aging; reports; CFO dashboard.

## Matching engine
Deterministic rules first (explainable), then AI suggestions with confidence; every match is explainable and
human-confirmable. No auto-close of reconciliation with unresolved required exceptions.

## Shared services
Status/workflow (m06), rules (m07), documents (m09), audit, authz, outbox, finance foundation (m19), matching
(m15a), finance AI (m27).

## MVP
Ingestion, matching, exceptions, colour status, reports. Journal recommendations flow to draft-only journals.
