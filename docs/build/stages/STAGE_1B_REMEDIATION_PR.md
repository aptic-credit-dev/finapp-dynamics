# Remediation pull request — ready to paste

**Base:** `main` ← **Head:** `fix/stage-1b-ci-remediation` (head SHA `ea2683c`)
**Create at:** https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...fix/stage-1b-ci-remediation?expand=1

**Title:**

```
Stage 1B: Remediate CI certification failure
```

**Body:**

```markdown
Remediates the CI failure on PR #3, which was **merged into `main` with a red required Smoke lane**.

## What happened
- PR #3 (`Stage 1B: Implement M02 Identity Foundation`) merged head `9baf98c` into `main` (`a94c0ab`).
- **DB lane: fully green** — `Assert PostgreSQL 16`, migrations (dry-run + real) and `DB integration specs`
  all passed; no DB step skipped.
- **Smoke lane: failed at Lint** — Build and PURE smoke were skipped. `main` had no required-check
  protection, so the merge went through despite the red lane.

## Root cause
`apps/api` excluded `test/**` from its build tsconfig, so the integration spec could only be type-aware
linted through a separate classic-`project` config (`apps/api/tsconfig.eslint.json`) that resolved
`@finapp/*` types via **built** `dist/*.d.ts`. CI's Smoke lane runs **lint before build**, so on a clean
checkout `dist/` was absent and the `Assert` helper (`t.equal`/`t.ok`) was unresolved — 173
`no-unsafe-call` / `no-unsafe-member-access` errors. Developer machines passed only because a prior build
had left `dist/` in place.

## Fix
- Align `apps/api` with every other workspace: include `test/**` in `apps/api/tsconfig.json` and reference
  `tools/test-runner`, so ESLint's `projectService` resolves the spec's imports to **source** — lint needs
  no prior build.
- Delete `apps/api/tsconfig.eslint.json` and its eslint override; fold `apps/api/test/**` into the standard
  test-file rule block.
- Declare the Nest application surface the spec drives (fixes three latent `TS2352` casts that `tsc` had
  never checked while the file was excluded).
- **Regression guard:** conformance now asserts every workspace with a non-empty `test/` dir includes it in
  its own `tsconfig.json` — the exact invariant whose absence broke CI.

## Validation (clean checkout: `dist` wiped, `npm ci`)
- `format:check` ✅ · `lint` **0 errors** ✅ · `build` ✅ · smoke **7 suites / 926 assertions** ✅
- DB lane **5 specs / 254 assertions** on PostgreSQL 15.2 ✅ (PostgreSQL 16 in CI is the authoritative gate)

## Governance required before merge
- Protect `main`: require the **Smoke** and **PostgreSQL 16 DB** lanes, block force-push and deletion,
  dismiss stale approvals. (This is the control that would have stopped PR #3 merging red.)
- Revoke the previously exposed PAT (`ghp_0jL…`).
- Confirm the public-visibility decision.

Do not merge until both lanes are green on this PR.
```

## After this PR is green and merged

- Pull `main`; record the remediation merge commit.
- Update `docs/build/stages/STAGE_1B_M02_IDENTITY_COMPLETION.md` and the manifest certification block to
  `smoke_certification: passed`, `merge_status: merged`, `stage_gate: go`.
- Stage 1C may then begin from the certified `main`.
