# Stage 5 — M27 Finance AI — Readiness

**Verdict: GO** (governance PR #64 merged; m27 `approved_for_build` on main `ccce6d6`).

## Gates
- **Stage approved:** `m27-finance-ai` is `approved_for_build` in `implementation-manifest.yaml` (gov PR #64 → main).
- **Dependencies present:** `m24-ai-foundation` (certified) + `m15-recon`/`m15a-matching` (implemented) + `m20-glrecon` (implemented).
- **Spec:** `docs/05-ai/FINANCE_AI.md` exists (recon match suggestions, classification, anomaly, risk, journal-recommendation drafting; human-reviewed; NO auto-post; explainable).
- **Naming reserved:** `ai.*` (shared), `AI_` (shared), no API prefix, no event family (naming-map).

## Design decisions resolved (→ ADR-109, ADR-110)
- No auto-post / auto-match / approval; suggestions feed draft journals + human approval only.
- Explainable matching: every suggestion carries features + reason codes + evidence; unexplained matches can't be accepted.
- M24 consumed by an `AiGatewayPort`; M15/M20 by opaque reference; M15a matching + M20 GL recon never duplicated; M15/M20 source of truth.
- Money is bigint minor units (no float); no balance mutation.
- No second AI engine, no second outbox, no HTTP surface.

## Risks / notes
- **mvp:partial** — MVP is reconciliation match suggestions as human-confirmable hints; anomaly/risk/journal-draft are advisory extensions.
- Generation uses M24's deterministic double (ADR-105); no real model/DLP (m41) ships.
