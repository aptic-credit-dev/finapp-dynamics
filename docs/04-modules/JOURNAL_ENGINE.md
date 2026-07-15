# Journal Engine (m21) + Approval (m22)

## Purpose
Turn reconciliation/operational outcomes into balanced, decimal-safe journal drafts, route them through maker-
checker approval, and (post-MVP) push approved entries to core systems for posting. Reference tables: m21 (18),
m22 approval (24).

## Capabilities
Journal recommendations (from reconciliation/AI); journal drafts (balanced: debits == credits); approval workflow
(maker-checker + SoD); posting requests + posting results (post-MVP, to core banking/accounting via integration);
period-close awareness; audit.

## Absolute controls
Decimal-safe money (no float); balanced-before-post; no duplicate posting; no posting without approval; no
posting into closed periods; **no AI auto-posting**; maker cannot be checker.

## Shared services
Status/workflow (m06), rules (m07), audit, authz, outbox, finance foundation (m19), GL recon (m20), integration
(m33) for posting push.

## MVP
Draft-only: recommend → draft → approve. **Posting to core systems is post-MVP** and gated by the certification
process and confirmed posting contracts.
