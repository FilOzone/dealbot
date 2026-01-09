# Release Flow with release-please

## Overview

This repository uses **[release-please](https://github.com/googleapis/release-please)** by Google to automate versioning based on [Conventional Commits](https://www.conventionalcommits.org/).

```
Developer merges PR with conventional commits
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

## Conventional Commits

Your commit messages determine the version bump:

### Commit Types

| Commit Prefix | Version Bump | Example |
|---------------|--------------|---------|
| `fix:` | Patch (0.1.0 → 0.1.1) | `fix: resolve payment bug` |
| `feat:` | Minor (0.1.0 → 0.2.0) | `feat: add dark mode` |
| `feat!:` or `BREAKING CHANGE:` | Major (0.1.0 → 1.0.0) | `feat!: redesign API` |
| `chore:`, `docs:`, `style:`, `refactor:`, `test:`, `ci:` | No release | Documentation, tests, etc. |

### Examples

**Patch release (bug fix):**
```bash
git commit -m "fix: prevent duplicate transactions"
# → Backend: 0.1.0 → 0.1.1
```

**Minor release (new feature):**
```bash
git commit -m "feat: add export to CSV functionality"
# → Backend: 0.1.0 → 0.2.0
```

**Major release (breaking change):**
```bash
git commit -m "feat!: change API response format

BREAKING CHANGE: Response structure changed from {data} to {result}"
# → Backend: 0.1.0 → 1.0.0
```

**No release (chores):**
```bash
git commit -m "chore: update dependencies"
# → No version bump, no release
```

## How It Works

### 1. Merge Code with Conventional Commits

```bash
# Feature branch with conventional commits
git checkout -b feat/user-export
# ... make changes ...
git commit -m "feat: add CSV export for users"
git push

# Create and merge PR
```

When merged to `main`:
- SHA images built: `sha-abc123def456...` (full 40-char SHA)
- Deployed to staging automatically

### 2. release-please Creates/Updates Release PR

**Automatically creates a PR titled:**
```
chore: release to production
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
✅ **Conventional commits** - Forces good commit hygiene

## Configuration

### release-please-config.json

See [release-please-config.json](../release-please-config.json) for the complete configuration.

Key settings:
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

SECURITY: Fixes CVE-2024-xxxxx"
```

This creates a patch release (0.1.0 → 0.1.1), but you can label the PR for faster review.

## Troubleshooting

### Release PR not created

**Check:**
- Are you using conventional commits? (`fix:`, `feat:`, etc.)
- Did you merge to `main`?
- Are there any non-conventional commits blocking it?

**Fix:**
- Ensure all commits follow conventional format
- If needed, manually trigger (retries release/retagging): `gh workflow run release-please.yml` (use this only when the images for the target commit already exist in ECR)

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
