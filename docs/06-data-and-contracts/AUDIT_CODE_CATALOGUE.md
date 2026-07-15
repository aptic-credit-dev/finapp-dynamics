# Audit Code Catalogue

~916 audit codes in the reference baseline, in a single registry (m03). Unregistered codes fail CI. Codes are
`SCREAMING_SNAKE` with a module tag and a severity (normal / critical) and a reason-required flag.

## Rules
- One registry; append-only; every controlled action writes an audit entry.
- Every mutating route's `auditCode` must be registered before it can ship.
- Security-sensitive actions (GO/NO-GO issuance, self-signoff blocks, production release, key compromise, DLP
  blocks, privileged access) are severity `critical`.
- Audit history is append-only and tamper-evident (chain anchors); evidence is never overwritten or silently
  deleted.

## Coverage
Codes exist for every domain: feedback, case, legal/litigation/recovery, finance (recon/journal/approval/posting),
AI, integration/webhook/event, automation/extension, commercial SaaS, security (SEC_/GRC_/PRIV_), and
certification (CERT_).
