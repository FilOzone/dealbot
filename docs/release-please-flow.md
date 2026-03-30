# Release Flow with release-please

## Overview

This repository uses **[release-please](https://github.com/googleapis/release-please)** by Google to automate versioning based on [Conventional Commits](https://www.conventionalcommits.org/).

**Conventional Commits are essential for this flow.** release-please parses commits on `main` (subject, type, scope, breaking markers). Messages that are not valid Conventional Commits, or types that are not reflected in the changelog configuration, may be ignored—so **no release PR is created or updated** even though code merged.

```
Developer merges PR; mainline commit message is conventional and recognized
  ↓
release-please analyzes commits
  ↓
Creates/Updates "Release PR" with version bumps
  ↓
Developer merges Release PR
  ↓
Images retagged with semver
  ↓
ArgoCD Image Updater detects new version
  ↓
Manual sync required to deploy to production
```

**Note:** Production auto-sync is disabled initially for safety.

## How we keep `main` commits compatible with release-please

These practices work together so merged commits stay parseable and release-please can stage production releases.

1. **[PR Title workflow](../.github/workflows/pr-title.yml)** — On pull requests, [`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request) validates the **PR title** against [Conventional Commits](https://www.conventionalcommits.org/). With no extra `types:` input, allowed types match [commitizen/conventional-commit-types](https://github.com/commitizen/conventional-commit-types) (e.g. `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`).

2. **Merge strategy** — Merge commits are **disabled** for pull requests. That steers merges toward **squash merge**, which—when the repository uses the default **“Use the PR title as the default squash merge commit subject”** (or equivalent)—makes the first line of the commit on `main` match the validated PR title. That line is what release-please sees for the merge.

3. **[release-please-config.json](../release-please-config.json)** — Root [`changelog-sections`](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md) lists the same family of commit types with `"hidden": false`, so routine types (including `chore`, `ci`, `docs`, etc.) produce changelog content. Without that, release-please can treat those commits as “non user-facing,” skip opening or updating a release PR, and you would see **no staging release** despite merges.

**Keep PR-title allowances and `changelog-sections` in sync:** Anything you add to allowed types in the PR title check should have a matching `changelog-sections` entry (same `type`, `hidden: false`) in [release-please-config.json](../release-please-config.json), or release-please may again skip releases for those commits.

> **Squash message drift** — If someone **edits the squash merge message** so the first line is **not** valid Conventional Commits (wrong syntax, unknown type, typo in `feat`/`fix`/`chore`, etc.), or uses a type **not** listed in `changelog-sections`, release-please may **drop** that commit or produce **no** changelog entry. Then it may log something like “No user facing commits found … skipping” or “No commits for path … skipping,” and **a release PR will not be staged** for that change. Prefer leaving the default squash text (PR title) unchanged after it passed the PR title check.

## Conventional Commits

What lands on **`main`** (especially the **first line** of a squash merge) drives semver and the release PR. PR title validation does not re-check every intermediate commit on the branch—only the title at review time.

### Commit types and version bumps

Default release-please / Node versioning (unless you change [`versioning`](https://github.com/googleapis/release-please/blob/main/docs/customizing.md#versioning-strategies) in config):

| Commit prefix | Typical version bump | Example |
|---------------|----------------------|---------|
| `fix:`, `perf:`, `revert:`, and other non-`feat` types (e.g. `chore:`, `docs:`, `refactor:`, …) | **Patch** (0.1.0 → 0.1.1) | `fix: resolve payment bug` |
| `feat:` | **Minor** (0.1.0 → 0.2.0) | `feat: add dark mode` |
| `feat!:` or `BREAKING CHANGE:` in body/footer | **Major** (0.1.0 → 1.0.0) | `feat!: redesign API` |

Dependency and housekeeping work (for example `chore(deps): …`) **does** count for staging a release, provided the message is conventional, the type is allowed on the PR, and the type appears in [release-please-config.json](../release-please-config.json) `changelog-sections`.

Per-app paths (`apps/backend`, `apps/web`) still apply: only commits that touch files under a package’s path affect that component’s release.

### Examples

**Patch release (bug fix):**
```bash
git commit -m "fix: prevent duplicate transactions"
# → Backend: 0.1.0 → 0.1.1 (when this commit touches apps/backend)
```

**Minor release (new feature):**
```bash
git commit -m "feat: add export to CSV functionality"
# → Backend: 0.1.0 → 0.2.0 (when this commit touches apps/backend)
```

**Major release (breaking change):**
```bash
git commit -m "feat!: change API response format

BREAKING CHANGE: Response structure changed from {data} to {result}"
# → Backend: 0.1.0 → 1.0.0
```

**Patch / release staging (chore, CI, docs, etc.):**
```bash
git commit -m "chore(deps): bump library X"
# → Patch bump and release PR update when apps/backend (or web) paths change,
#    as long as the type is recognized and listed in changelog-sections.
```

## How It Works

### 1. Merge Code with Conventional Commits

```bash
# Feature branch with conventional commits
git checkout -b feat/user-export
# ... make changes ...
git commit -m "feat: add CSV export for users"
git push

# Create and merge PR (squash merge; keep default subject = PR title when prompted)
```

When merged to `main`:
- SHA images built: `sha-abc123def456...` (full 40-char SHA)
- Deployed to staging automatically

### 2. release-please Creates/Updates Release PR

**Automatically creates a PR titled like:**
```
chore: release to production (backend 0.2.0)
```

**The PR includes:**
- ✅ Updated `apps/backend/package.json` version
- ✅ Updated `apps/web/package.json` version (if changed)
- ✅ Generated `CHANGELOG.md` entries
- ✅ Grouped by app (backend/web)

**Example PR:**
```markdown
## Backend 0.2.0

### Features
* add CSV export for users (abc123def456...)

### Bug Fixes
* prevent duplicate transactions (def456789abc...)

---

## Web 0.1.1

### Bug Fixes
* fix button alignment on mobile (789abcdef012...)
```

### 3. Developer Reviews and Merges

1. **Review the release PR**
   - Check version bumps are correct
   - Review changelog entries
   - Verify images are in staging

2. **Merge the PR**
   - release-please creates git tags **only for apps with changes**:
     - `backend-v0.2.0` (only if backend had changes)
     - `web-v0.1.1` (only if web had changes)
   - release-please creates GitHub Releases

   > **Note:** Apps are released independently. If only web has changes, only `web-v*` is tagged and released. The [release workflow](../.github/workflows/release-please.yml) uses conditional checks ([backend](../.github/workflows/release-please.yml#L45) | [web](../.github/workflows/release-please.yml#L75)) to ensure images are only retagged when `*_release_created` is true for that component.

3. **Workflow retags images** (conditionally, only for released components)
   - `sha-abc123def456...` → `v0.2.0` (backend, if backend was released)
   - `sha-def456789abc...` → `v0.1.1` (web, if web was released)

4. **ArgoCD Image Updater detects new version**
   - Image Updater watches for semver tags in GHCR
   - Marks Application as OutOfSync

5. **Manual deployment to production**
   - Review changes in ArgoCD UI
   - Sync manually via UI or CLI: `argocd app sync dealbot-backend-prod`
   - Can enable auto-sync later once confidence is established

## Per-App Versioning

Each app has **independent versions** in `package.json`:

```
apps/backend/package.json: "version": "0.2.0"
apps/web/package.json: "version": "0.1.1"
```

### Scenarios

**Backend-only change:**
```bash
git commit -m "feat(backend): add new API endpoint"
# → Backend: 0.1.0 → 0.2.0
# → Web: 0.1.0 (no change)
```

**Web-only change:**
```bash
git commit -m "fix(web): button styling"
# → Backend: 0.1.0 (no change)
# → Web: 0.1.0 → 0.1.1
```

**Both change:**
```bash
git commit -m "feat: add user profiles
- Add profile API endpoint (backend)
- Add profile UI page (web)"
# → Backend: 0.1.0 → 0.2.0
# → Web: 0.1.0 → 0.2.0
```

## Benefits

✅ **No manual version management** - Determined by commits
✅ **Automatic CHANGELOGs** - Generated from commit messages
✅ **Semantic versioning** - Industry standard
✅ **Independent app versions** - Backend and web versioned separately
✅ **Type-safe** - Uses existing `package.json` versions
✅ **Conventional commits** - Align PR titles and mainline squash subjects with release automation

## Configuration

### release-please-config.json

See [release-please-config.json](../release-please-config.json) for the complete configuration.

Key settings:
- `changelog-sections` → Maps conventional **types** to changelog sections with `hidden: false` so merges using those types still open/update release PRs (aligned with [pr-title.yml](../.github/workflows/pr-title.yml) / commitizen defaults)
- `separate-pull-requests: false` → Single PR for all apps
- `release-type: node` → Uses package.json for versioning
- Configures independent versioning for backend and web apps

### .release-please-manifest.json

See [.release-please-manifest.json](../.release-please-manifest.json) for current versions.

Tracks last released versions. Updated automatically by release-please.

## Hotfixes

For urgent fixes, still use conventional commits:

```bash
git commit -m "fix!: critical security patch

BREAKING CHANGE: describe the incompatible change"
```

`fix!` / `BREAKING CHANGE` triggers a **major** bump with default versioning. For a **patch-only** hotfix, use `fix:` (no `!`) and no breaking footer. Label the PR for faster review as needed.

## Troubleshooting

### Release PR not created

**Check:**
- Does the commit on `main` use valid **Conventional Commits** on the **first line** (especially after squash merge)?
- Did the squash subject drift from the PR title (manual edit, unknown type, or non-conventional text)?
- Does the commit **type** appear in [release-please-config.json](../release-please-config.json) `changelog-sections` (and is it allowed by [pr-title.yml](../.github/workflows/pr-title.yml))?
- Did you merge to `main`?
- For the component you expect: did the merge touch files under `apps/backend` or `apps/web`?

**Fix:**
- Prefer **squash merge** with the **default subject = PR title** so the validated title becomes the commit message release-please parses.
- Align PR title types with `changelog-sections` when you add new allowed types.
- If needed, manually trigger (retries release/retagging): `gh workflow run release-please.yml` (use this only when images for the target commit already exist in GHCR)

### Wrong version bump

**Fix:**
- Close the release PR
- Update commit messages if needed
- Push new commit
- release-please will update the PR

### Need to skip a release

Just don't merge the release PR. Commits will accumulate and be included in the next release.

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [release-please Documentation](https://github.com/googleapis/release-please)
- [Semantic Versioning](https://semver.org/)
