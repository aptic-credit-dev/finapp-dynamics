# Domain Boundaries

## The rule
Each module owns its authoritative tables and its business validation. It uses shared services through approved
contracts, does not read or write another module's tables directly, and interacts across modules only via APIs or
typed domain events. Every module: uses tenant context, uses authorization, writes audit, uses idempotency for
high-risk actions, has explicit error handling, has tests, has documentation, and has an owner.

## Boundary certification (enforced at build time)
A static check blocks release on any unauthorized cross-module database access. This is what keeps the modular
monolith from decaying into a tangle and what makes later service extraction possible.

## Domain groupings
- **Foundation** — tenancy, identity, audit, workflow/rules/notify/docs. Owns the spine; owned by no business
  domain.
- **Operational** — Feedback, Case. Feedback events feed Case; Case escalates to Legal.
- **Legal** — Legal Matter, Litigation, Recovery, Legal Docs. Enforces privilege + ethical walls.
- **Finance** — Finance Operations, Bank Recon + Matching, GL Recon, Journal, Approval, Finance Integration.
  Maker-checker, decimal-safe, draft-only posting.
- **AI** — AI Foundation + Operational/Legal/Finance AI + Executive Copilot + governance. Reads across domains
  read-only via governed gateways; never writes controlled records.
- **Enterprise platform** — studio, analytics, integration, marketplace, dev portal, events, governance,
  automation, commercial SaaS, resilience, security/GRC, certification. Horizontal services every domain reuses.

## Cross-domain flows (event-driven)
Feedback → Case (escalation) → Legal Matter (conversion) → Recovery. Operational/Legal/Recovery activity →
Finance transactions → Reconciliation → Journal (draft) → Approval → posting request. AI consumes all read-only.

## Non-duplication mandate
No domain introduces its own tenancy, auth, audit, outbox, entitlement engine, key store, or security control
plane. Phase 7 verticals inherit all shared services and enter the certification matrix.
