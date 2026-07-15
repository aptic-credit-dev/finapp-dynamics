# Post-Stage 0 Merge — Stage 1 Branch Realignment and Final Readiness Check

**Readiness report** · 2026-07-15 · Task: branch realignment and verification only. No Stage 1
implementation.

## Verdict: NO-GO for realignment — STOPPED, no branch was modified

> **The premise of this task is not true. Stage 0 has NOT been merged into `main`.**
>
> `origin/main` is still `cf79043` — the original handover-package commit. It contains **none** of the
> 107 Stage 0 files: no `package.json`, no `packages/kernel/`, no `.github/workflows/ci.yml`. **No pull
> request has ever existed** on this repository (0 refs under `refs/pull/*`), so no CI run has ever
> happened and nothing was reviewed or merged.

**The prescribed realignment was not executed, and executing it would have destroyed the Stage 0
baseline.** `git reset --hard origin/main` on `feature/stage-1-saas-foundation` would have moved that
branch from `8e55cdf` (the full Stage 0 toolchain) back to `cf79043` (handover docs only), deleting 107
files — the entire monorepo, kernel, contracts, migration runner, test harness and CI workflow — and
`--force-with-lease` would have succeeded, because the lease check compares against the *remote branch*,
which is unchanged. The lease would have been satisfied and the baseline lost anyway.

Stage 1 would then have begun from a repository with no toolchain at all.

Nothing was reset, force-pushed, tagged or deleted. The repository is exactly as it was.

---

## 1. Repository and remote state

| Check | Result |
|---|---|
| Repository root | ✅ `C:/Users/HP/dev/finapp-dynamics` |
| Remote | ✅ `https://github.com/aptic-credit-dev/finapp-dynamics.git` — **credential-free** (no `@`, no `ghp_`, no embedded credentials) |
| Working tree | ✅ clean (0 uncommitted) |
| Merge / rebase / cherry-pick in progress | ✅ none |
| HEAD | ✅ attached to `feature/stage-0-foundation` |
| Fetch | ✅ `--all --tags --prune`, no new refs |

### Compromised PAT — status unchanged and still unresolved

The remote is credential-free and no token is in `.git/config`. Pushes authenticate through Git
Credential Manager as **`wacherakelvin`**.

**Whether the compromised token `ghp_0jL…` has actually been revoked cannot be determined from here**,
and there is a reason to think it has not: write access was restored by granting `wacherakelvin`
repository access, which does not touch the leaked token, and the GCM-cached credential is opaque — it
may still *be* that PAT. This remains the highest residual risk (R1).

## 2. Final Stage 0 baseline

| Item | Value |
|---|---|
| **`origin/main` commit** | **`cf79043`** — *Complete handover package: all architecture docs, ADRs, manifests, and prompts* |
| Stage 0 merge / squash commit | **DOES NOT EXIST** — no merge has occurred |
| Stage 0 pull request | **NEVER OPENED** — 0 refs under `refs/pull/*` |
| PostgreSQL 16 CI result | **NEVER RUN** — no PR, and `push` triggers are scoped to `main`/`develop` |
| `stage-0-complete` tag target | `8e55cdf` — *chore(stage-0): finalize repository baseline* (annotated; unchanged, **not moved**) |
| `origin/feature/stage-0-foundation` | `4e66dc0` — 6 commits ahead of `main`, 0 behind |
| `origin/feature/stage-1-saas-foundation` | `8e55cdf` — 3 commits ahead of `main`, 0 behind |

### Stage 0 commits created after the tag

The tag deliberately marks the verified **toolchain** baseline. Three governance commits sit on
`feature/stage-0-foundation` after it, none of which are in any tag:

| Commit | Message | In `stage-0-complete`? |
|---|---|---|
| `f5e56ce` | `docs(stage-0): add pre-Stage 1 baseline and GitHub governance report` | ❌ after the tag |
| `2fee15e` | `fix(ci): run the PostgreSQL 16 database lane on pull requests too` | ❌ after the tag |
| `4e66dc0` | `docs(stage-0): update baseline report after write-access resolution` | ❌ after the tag |

### On the `stage-0-governed-complete` tag

**Not created.** A tag for "the fully merged and governed Stage 0 state" cannot honestly be created,
because that state does not exist: nothing is merged, and the governing CI has never run. Tagging
`4e66dc0` as *governed* would assert a review and a PostgreSQL 16 certification that never happened —
the tag would be a false record in a repository whose whole design is audit-first (ADR-005).

Create it **after** the PR merges and the `postgres:16` lane passes, pointing at the merge commit on
`main`. `stage-0-complete` was **not** moved, replaced or force-updated.

## 3. Stage 1 branch — realignment NOT performed

### Precondition check (passed)

`feature/stage-1-saas-foundation` contains **no unique Stage 1 implementation**:

| Check | Result |
|---|---|
| `diff stage-0-complete..origin/feature/stage-1-saas-foundation` | ✅ **0 files** |
| Its 3 commits ahead of `main` | `8e55cdf`, `6b7692d`, `1a3795c` — all **Stage 0** commits, not Stage 1 work |
| Business `.ts` outside `kernel`/`contracts` | ✅ **0** |
| Migrations (`packages/*/migrations/*.sql`) | ✅ **0** |
| Permissions / events / APIs / audit codes added | ✅ **none** |
| Uncommitted work on the branch | ✅ none |

### Why the reset was still refused

The branch-level precondition passes — but the *target* is wrong. The procedure assumes
`origin/main` ⊇ Stage 0. It does not:

```text
  origin/main contains 1a3795c (stage-0 scaffold)?  NO
  origin/main contains 8e55cdf (stage-0-complete)?   NO

  ABSENT on origin/main: package.json
  ABSENT on origin/main: tsconfig.base.json
  ABSENT on origin/main: packages/kernel/src/tokens.ts
  ABSENT on origin/main: .github/workflows/ci.yml
```

`git rev-list --left-right --count origin/main...origin/feature/stage-1-saas-foundation` → `0  3`.
Zero commits on `main` that Stage 1 lacks; three Stage 0 commits on Stage 1 that `main` lacks. The
Stage 1 branch is **ahead of** `main`, not behind it. There is nothing to realign *to* — realigning
would be a regression, not a fast-forward.

The task's own guard — *"If the Stage 1 branch contains unique work, do not reset it"* — reads on
*Stage 1 implementation*, of which there is none. It does not cover this case: the branch's unique
commits are the Stage 0 baseline itself. Applying the letter of the procedure here would have deleted
the thing it was written to protect.

| | Before (unchanged) | After a `reset --hard origin/main` |
|---|---|---|
| `feature/stage-1-saas-foundation` | `8e55cdf` — full Stage 0 | `cf79043` — handover docs only |
| Files | 107 Stage 0 files present | **107 files deleted** |
| Toolchain | monorepo, kernel, contracts, migrate, test-runner, CI | **none** |

## 4. Branch alignment verification

Expected on a correct realignment: zero file differences, zero ahead, zero behind. **Actual:**

| Measure | Expected | Actual |
|---|---|---|
| `diff --stat origin/main...feature/stage-1-saas-foundation` | 0 files | **107 files, +5,003 / −42** |
| `rev-list --left-right --count` (main ↔ stage-1) | `0 0` | **`0 3`** |

This is not a defect in the Stage 1 branch. It is the expected, correct arithmetic when `main` has not
received Stage 0. Alignment becomes achievable — and trivial — the moment the PR merges.

## 5. Baseline verification

Run on the current tree (`4e66dc0`):

| Gate | Command | Result |
|---|---|---|
| Install | `npm install` | ✅ 0 vulnerabilities |
| Lint | `npm run lint` | ✅ clean |
| Build | `npm run build` | ✅ clean |
| Format | `npm run format:check` | ✅ clean |
| Smoke lane | `npm run test:smoke` | ✅ **3 suites / 73 assertions passing** |

### PostgreSQL certification

**Not certified on PostgreSQL 16. Not run.**

- The authoritative `postgres:16` CI lane has **never executed** — it needs a pull request, and none
  exists.
- Locally there is still no PostgreSQL 16: the Docker daemon is not running and nothing listens on 5432.
  Only PostgreSQL **15.2** binaries exist on this machine.
- **PostgreSQL 15 was not substituted** for the final certification, per instruction. The RLS convention
  proof (1 spec / 26 assertions) remains green only on 15.2 from the original Stage 0 session.

The CI lane is correctly configured for this: `postgres:16` pinned, the pull-request gate removed
(`2fee15e`), plus a fail-closed `DATABASE_URL` guard and a `server_version_num` 16.x assertion so the
lane cannot report a false green or silently certify the wrong version. **None of that has run.**

## 6. Branch-protection status

**NOT ENABLED — `main` is unprotected.** Unchanged since the previous report.

It could not have been enabled: required status checks can only be selected once GitHub has observed a
workflow run, and no run has ever occurred. The full specification remains in
`docs/build/GITHUB_BRANCH_PROTECTION_RECOMMENDATION.md` (pull request required; ≥1 approval; required
checks `Smoke lane` + `DB lane`; force pushes blocked; deletion blocked; direct pushes restricted;
admin bypass off).

The ordering is forced and unavoidable: **PR → CI runs once → checks become selectable → protection.**

## 7. Commands and checks performed

Read-only: `git rev-parse --show-toplevel`, `git remote -v`, credential-free assertion on the remote
URL, `git fetch --all --tags --prune`, `git status --short --branch`, in-progress-operation probes,
detached-HEAD probe, `git log --oneline --decorate --graph --all -20`.

Merge verification: `git ls-remote origin` (live, uncached), `git ls-remote origin 'refs/pull/*'`,
`git merge-base --is-ancestor 1a3795c origin/main`, `git merge-base --is-ancestor 8e55cdf origin/main`,
`git cat-file -e origin/main:<path>` for four Stage 0 files.

Divergence: `git rev-list --left-right --count origin/main...origin/feature/stage-1-saas-foundation`,
`git diff --stat origin/main...origin/feature/stage-1-saas-foundation`,
`git log --oneline origin/main..origin/feature/stage-1-saas-foundation`.

Stage 1 cleanliness: `git diff --name-only stage-0-complete..origin/feature/stage-1-saas-foundation`,
business-source and migration counts.

Baseline: `npm install`, `npm run verify`, `npm run format:check`.

Impact modelling: `git diff --name-only origin/main origin/feature/stage-1-saas-foundation` (107 files
that a reset would have removed).

**Not run:** `git reset --hard`, `git push --force-with-lease`, `git tag`. No branch, tag or remote ref
was created, moved or deleted.

## 8. Remaining risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The compromised PAT is never revoked | **High** | Revoke `ghp_0jL…` at `github.com/settings/tokens`. Restoring access by granting `wacherakelvin` rights did not revoke it; the symptom is gone while the exposure is not. |
| R2 | The realignment is retried against an unmerged `main` | **High** | This report. Re-running the prescribed procedure today deletes the Stage 0 baseline from the Stage 1 branch, and `--force-with-lease` will **not** stop it — the lease compares against the unchanged remote branch and passes. Merge first; realign second. |
| R3 | Stage 1 is implemented before Stage 0 merges | Medium | Stage 1 can proceed on its branch (it has the full baseline), but its PR will carry all Stage 0 commits until Stage 0 merges, making review confusing. Merge Stage 0 first. |
| R4 | Stage 1 merges without a `postgres:16` run | **Medium–High** | Stage 1 creates the first real tenant tables; RLS is the only thing keeping tenants apart and has only been proved on 15.2. |
| R5 | `main` stays unprotected | Medium | `wacherakelvin` now has write access and nothing mechanically prevents a direct push to `main`. |
| R6 | A future auth failure is "fixed" by re-embedding a token in the remote URL | **High** | Prohibited — that is how the current exposure happened. Use GCM or SSH. |

## 9. Recommendation

### NO-GO for realignment · CONDITIONAL GO for Stage 1 implementation

**NO-GO for this task's realignment.** Its precondition — Stage 0 merged into `main` — is false.
Realignment is not merely unnecessary; it is destructive today. Nothing was changed. Re-run this task
**after** the merge, at which point `reset --hard origin/main` becomes a correct no-op-equivalent
fast-forward and every assertion in §4 will pass.

**CONDITIONAL GO for Stage 1 implementation**, unchanged from the previous report.
`feature/stage-1-saas-foundation` is verified: based exactly on `stage-0-complete`, zero Stage 1 code,
zero migrations, and it carries the complete, verified Stage 0 baseline (build/lint/format/smoke all
green). Stage 1 can safely begin on it.

Note it does **not** yet carry the three post-tag governance commits (`f5e56ce`, `2fee15e`, `4e66dc0`) —
including the CI DB-lane fix. It will inherit them once Stage 0 merges to `main` and Stage 1 syncs. That
is the realignment this task was meant to perform, in its correct order.

### Required actions, in order

| # | Action | Owner | Notes |
|---|---|---|---|
| **A1** | **Revoke the compromised PAT** | Repository owner | Immediately. Independent of everything else. |
| **A2** | **Open the Stage 0 pull request** | Engineer | `https://github.com/aptic-credit-dev/finapp-dynamics/compare/main...feature/stage-0-foundation?expand=1` — **this is the blocking step**; it triggers the first CI run ever. |
| **A3** | Confirm both lanes green, including **`Assert PostgreSQL 16`** (`server_version_num=16xxxx`) | Engineer | The certification that does not yet exist. |
| **A4** | Review and merge the PR into `main` | Reviewer | Squash-merge per `README.md`. Not automatic. |
| **A5** | Configure branch protection on `main` | Repository admin | Only possible after A3 — checks must be observed before they can be required. |
| **A6** | **Re-run this realignment task** | Engineer | After A4. It then becomes correct and safe. |
| **A7** | Optionally tag `stage-0-governed-complete` on the merge commit | Engineer | After A4 + A3, when the claim is true. Do not move `stage-0-complete`. |

**Do not merge Stage 1 to `main` until A3 has passed.**
