# GitHub Branch Protection — Recommendation

**Status: PENDING MANUAL CONFIGURATION.** Nothing in this document is active yet.

Branch protection could not be configured from this environment: the GitHub CLI is not installed and
protection rules cannot be set through plain `git`. The settings below must be applied by a repository
admin through the GitHub web UI (or by an authenticated `gh`/API call). Until then, `main` is
unprotected and direct pushes to it are possible.

Repository: `aptic-credit-dev/finapp-dynamics`
Protected branch: **`main`**

---

## 1. Required settings for `main`

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | **On** | No direct pushes to the releasable branch. |
| Required approvals | **1** (minimum) | Matches the review requirement in `README.md`. Raise to 2 once the team is larger than two engineers. |
| Dismiss stale pull request approvals when new commits are pushed | **On** | An approval must describe the code that actually merges, not an earlier version of it. |
| Require conversation resolution before merging | **On** | Review findings cannot be merged past silently. |
| Require status checks to pass before merging | **On** | See §2. |
| Require branches to be up to date before merging | **On** | Prevents a semantic conflict merging green against a stale base. |
| Require linear history | **On** | Matches the squash-merge strategy in `README.md`. |
| Block force pushes | **On** | The audit trail is a deliverable (ADR-005 is audit-first); rewritten history destroys it. |
| Block branch deletion | **On** | `main` must not be deletable. |
| Restrict who can push | **On** — no direct pushers | Everything arrives through a reviewed pull request. |
| Do not allow bypassing the above settings | **On** (include administrators) | See §4. |
| Require signed commits | **Off for now** | See §5. |

---

## 2. Required status checks

Check names come from the job `name:` values in `.github/workflows/ci.yml`. They only become selectable
in the GitHub UI **after the workflow has run at least once on the repository** — so push a branch and
open the Stage 0 pull request first, then add these.

| Check | Job | When it runs | Required? |
|---|---|---|---|
| **Smoke lane** | `smoke` | Every pull request | **Yes — required.** Runs format check, lint, build, and the PURE smoke suites. No database needed. |
| **DB lane** | `db` | `push` to `main`/`develop` only | **See the caveat below.** Runs migrations and the DB integration specs against `postgres:16`. |

### The DB lane caveat — read before requiring it

As currently written, the DB lane is gated on `if: github.event_name == 'push'`, so **it does not run on
pull requests**. If you mark it required while it never runs on a PR, every PR will block forever waiting
for a check that cannot report.

Pick one before requiring it:

- **Option A (recommended).** Change the DB lane's condition so it also runs on pull requests, then mark
  it required. This is the honest reading of "tenant isolation is proven, not assumed" — the DB lane is
  the only thing that proves RLS, and a PR that breaks isolation should not be mergeable.
- **Option B.** Leave it push-only and do **not** mark it required. `main` is then protected only by the
  smoke lane, and an RLS regression is caught after merge rather than before.

Either way, the **first successful `postgres:16` DB-lane run is a hard precondition for merging Stage 1**
(see §6).

---

## 3. `develop`

`README.md` describes a trunk-based flow with a long-lived `develop`. `develop` does not exist on the
remote yet. If it is created, protect it with the same rules as `main` except:

- Required approvals may be **1**.
- Linear history may be relaxed if merge commits are wanted for stage integration.

---

## 4. Administrator bypass

**Recommendation: include administrators in the restrictions** ("Do not allow bypassing the above
settings").

This platform's controls are built on the idea that no single identity both makes and approves a
controlled change (maker-checker and SoD, ADR-007). An admin who can bypass review on the branch that
produces releases is that same hole one level up. Grant a documented, time-bound exception for a genuine
emergency instead of leaving a standing bypass — that is the same posture ADR-009 requires for
privileged access.

---

## 5. Signed commits

**Recommendation: leave off until the team can support it consistently.**

Requiring signed commits before every contributor (and any CI identity that commits) has working signing
keys blocks all merges. Revisit once key distribution is solved, and turn it on deliberately — it is
worth having, just not worth a broken pipeline first.

---

## 6. Stage 0 / Stage 1 workflow

```text
feature/stage-0-foundation
        │  pull request + CI (smoke lane)
        ▼
      main  ────────────────►  tag: stage-0-complete
        │
        ▼
feature/stage-1-saas-foundation   (branched from stage-0-complete)
        │  pull request + CI (smoke lane + postgres:16 DB lane)
        ▼
      main
```

Hard rule carried into Stage 1: **do not merge Stage 1 to `main` until the `postgres:16` DB lane has
passed in CI at least once.** The Stage 0 RLS convention was proved locally against PostgreSQL **15.2**
(the only server available on the build machine). RLS FORCE, `tenant_isolation`, and composite-FK
semantics are identical on 15 and 16, so that proof is real — but it is not the certification the
platform targets, and Stage 1 is the first stage that creates actual tenant tables depending on it.

---

## 7. Manual configuration steps

1. Go to `https://github.com/aptic-credit-dev/finapp-dynamics/settings/branches`.
2. Under **Branch protection rules**, click **Add branch ruleset** (or **Add rule** for the classic UI).
3. Branch name pattern: `main`.
4. Enable, per §1:
   - Require a pull request before merging → Required approvals: **1**
   - Dismiss stale pull request approvals when new commits are pushed
   - Require conversation resolution before merging
   - Require status checks to pass before merging → Require branches to be up to date
   - Require linear history
   - Block force pushes
   - Block deletions
   - Do not allow bypassing the above settings
5. Under **Status checks that are required**, search for and add **`Smoke lane`**.
   *If it does not appear, the workflow has not run yet — open the Stage 0 pull request first, let CI
   run, then return to this step.*
6. Decide the DB lane per §2, then add **`DB lane`** if you chose Option A.
7. Save.
8. Verify: `https://github.com/aptic-credit-dev/finapp-dynamics/settings/branches` shows the rule as
   active, and a test push directly to `main` is rejected.

### If you prefer the CLI

Requires `gh` installed and authenticated with admin rights on the repository:

```bash
gh api -X PUT repos/aptic-credit-dev/finapp-dynamics/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["Smoke lane"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

---

## 8. Verification checklist for the admin

- [ ] Rule exists on `main` and shows as **Active**.
- [ ] A direct `git push origin main` is rejected.
- [ ] A pull request cannot merge while **Smoke lane** is failing.
- [ ] A pull request cannot merge without an approval.
- [ ] A force push to `main` is rejected.
- [ ] The DB lane decision (§2) is made and recorded.
- [ ] The compromised PAT has been revoked (see the completion report).
