# Phase 7 — Vertical Portfolio (indicative)

The portfolio below is indicative and subject to business prioritisation (see OPEN_QUESTIONS.md). Each vertical
reuses the horizontal platform and enters the certification matrix.

| Vertical | Description | Primary reuse |
|---|---|---|
| Lending operations suite | End-to-end lending servicing on ApticOne data | Case, Finance, AI, integration |
| Insurance operations suite | Policy/claims operations on BimaPro data | Feedback, Case, Finance, integration |
| Bonds & guarantees | AutoBonds/Crystal Bonds workflows | Legal, Finance, integration |
| Debt recovery & enforcement | Packaged recovery vertical | Legal, Recovery, Finance, AI |
| Regulatory & compliance ops | Regulator-facing reporting + evidence | GRC, reporting, audit |
| Customer experience suite | Omnichannel feedback + closed-loop CX | Feedback, AI, analytics |
| Treasury & reconciliation | Multi-bank reconciliation + close | Bank/GL recon, journal, finance AI |

## Approach
Prioritise the vertical with the clearest internal demand and cleanest data (candidate: lending or reconciliation
treasury). Build it as the reference vertical that proves the Phase 7 pattern — commercial surface via 6F, events
via m06, controls via 6H, certification via m42 — then template the rest.

## Commercialisation
Each certified vertical becomes a packaged, sellable offering for external tenants via the commercial SaaS layer
(plans, entitlements, metering, billing, white-labelling, custom domains).
