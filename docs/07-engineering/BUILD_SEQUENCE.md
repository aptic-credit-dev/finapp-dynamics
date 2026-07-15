# Build Sequence

Strict dependency order; one approved stage at a time. Each stage ends with tests green, docs + manifest updated,
and a commit.

1. **Stage 0 — Toolchain.** Monorepo, TS project references, lint/format, migration runner, CI skeleton, test
   harness. No business logic.
2. **Stage 1 — SaaS foundation.** m01 → m02 → m03 → m06 → m07 → m08 → m09 → m04. Prove tenant isolation + audit.
3. **Stage 2 — Operational.** m12 feedback → m13 case.
4. **Stage 3 — Finance.** m19 → m15/m15a → m20 → m21 → m22 → m23. Draft-only posting.
5. **Stage 4 — Legal.** m14 → m16 → m17 → m18.
6. **Stage 5 — AI.** m24 → m25 → m26 → m27 → m28 → m29.
7. **Stage 6 — Enterprise platform.** m30 → m31 → m32 → m33 → m34 → m35 → m36 → m37 → m38 → m39 → m40 → m41 → m42.
8. **Pilot + hardening.** Internal pilot per the §53 scope; pentest, DR, load/chaos, real migration.
9. **Phase 7.** Vertical business solutions on the live platform.

## Per-stage checklist
Build → permissions + events + audit codes → tests (smoke + DB spec) → run full baseline → update docs + manifest
→ commit → request next stage. Never start an unapproved stage; never mark `implemented` without tested code.
