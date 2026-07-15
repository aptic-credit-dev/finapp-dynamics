# Module Build Prompt Index

A reusable per-module prompt template plus the module order. Use the template for every module after Stage 1.

## Per-module template
> Build `<module>` (`<mNN-name>`), Phase `<n>`, per `docs/04-modules/<DOC>.md` (or 03-platform / 05-ai). It owns
> `<tables>` and consumes shared services `<list>` via contracts. Enforce tenant isolation (RLS FORCE), authz,
> audit, and idempotency for high-risk actions. Add its permissions, domain events (through the m06 outbox),
> audit codes (registered), and tests (PURE smoke + DB spec). Respect all `CLAUDE.md` invariants — no duplicate
> shared services, maker-checker + SoD, decimal-safe money, no AI-executed controlled actions, no auto-post. Run
> the stage's suites + the full baseline + conformance. Update docs + manifest. Commit. Stop and request the next
> module.

## Module order (matches BUILD_SEQUENCE.md)
Stage 2: m12, m13. Stage 3: m19, m15/m15a, m20, m21, m22, m23. Stage 4: m14, m16, m17, m18. Stage 5: m24, m25,
m26, m27, m28, m29. Stage 6: m30, m31, m32, m33, m34, m35, m36, m37, m38, m39, m40, m41, m42.

## Reminders baked into every module prompt
- Permissions + events + audit codes + tests ship with the code — never after.
- Never claim an untested integration is production-ready; classify connector status honestly.
- Never mark the manifest `implemented` without tested code.
- Keep the docs and manifest synchronized in the same change.
