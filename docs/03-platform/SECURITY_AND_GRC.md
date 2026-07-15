# Security & GRC

The Phase 6H security control plane (m41-security, 79 reference tables) governs POSTURE over the whole platform
and never replaces the authoritative controls (auth verifies identity, RBAC enforces permissions, audit records,
encryption protects data).

## Domains
Identity Governance & Administration (JML, access requests, certification, dormant/orphaned detection, SoD),
Privileged Access Management (just-in-time, time-bound, break-glass), Zero Trust (deny-by-default posture over
RBAC), Data Classification & DLP (server-side, no bypass), cryptography & key governance (references only, no raw
keys; algorithm deprecation), GRC (frameworks, controls, policies, evidence, risk register, exceptions,
third-party risk), privacy (processing registry, DPIA, data-subject requests that cannot bypass lawful
restrictions), and SOC readiness (event catalogue, detection, alerts, vulnerabilities).

## Non-negotiables
Least privilege · deny by default · SoD + no self-approval · time-bound privileged access · classification
before sensitive-data handling · encryption in transit + at rest · controlled key management (no raw key
storage) · server-side DLP · versioned immutable-once-published policies · time-bound risk acceptance · controlled
expiring exceptions · DSRs cannot bypass legal hold / retention / investigation · idempotent security-event
ingestion · no security event disappears silently · no audit evidence overwritten.

## Compliance stance
Technical controls produce **readiness and evidence**, not certification. ISO 27001 / SOC 2 / GDPR / Kenya DPA
are tracked as readiness with evidence; certification is never claimed from technical controls alone.
