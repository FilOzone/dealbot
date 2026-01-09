# Automated Release Process

This repository uses an automated GitOps release workflow to promote changes from staging to production.

## Overview

```
Code merged to main
  ↓
Build Docker images (e.g., sha-<sha> and sha-<run>-<sha>)
  ↓
ArgoCD auto-deploys to STAGING (watches ordered tags via Image Updater)
  ↓
release-please opens/updates Release PR
  ↓
Developer reviews and merges PR
  ↓
Retag same images with semver (e.g., v1.2.3)
  ↓
ArgoCD Image Updater detects new version in PRODUCTION
  ↓
Manual approval required to sync (initially)
```

**Note:** Production auto-sync is disabled initially for safety. After confidence is established, it can be enabled.

## How It Works

### 1. Merge to Main (`docker-build.yml`)

When you merge a PR to `main`:

**Path Detection:**
- Detects which apps changed (backend, web, or both)
- Only builds images for apps that actually changed

**Image Building:**
- Builds Docker images with:
  - `sha-<git-sha>` (stable pointer used for promotion/retagging)
  - `sha-<run-number>-<git-sha>` (monotonic tag suitable for ArgoCD staging policies)
- Example: `ghcr.io/filozone/dealbot-backend:sha-1234-<sha>`

**ArgoCD Deploys to Staging:**
- ArgoCD Image Updater watches for ordered `sha-<run>-<sha>` tags in staging
- Automatically deploys new images to staging environment

**Auto-Create Release PR:**
- release-please opens/updates a single PR (by default titled `chore: release to production`) containing:
  - Per-app `package.json` version bumps
  - Changelog entries based on Conventional Commits

### 2. Review and Merge Release PR

**Developer Actions:**
1. Review the auto-created PR
2. (Optional) Edit `VERSION` file if different version bump needed:
   - Minor bump: `v0.2.0` (default)
   - Patch bump: `v0.1.1`
   - Major bump: `v1.0.0`
3. Merge the PR

**What Happens When the Release PR is Merged:**

1. **Docker images build** from the merge commit (tagged `sha-<sha>` and `sha-<run>-<sha>`)
2. **release-please creates GitHub Releases/tags** (e.g., `backend-v0.2.0`, `web-v0.1.1`) and outputs the release `sha`
3. **Container images are retagged** by workflow to `v<version>` (e.g., `sha-<sha>` → `v0.2.0`)
4. **ArgoCD Image Updater detects new version** (e.g., `v0.2.0`) and marks Application as OutOfSync
5. **Manual sync required** to deploy to production (via ArgoCD UI or CLI)

**Important:** Both container images AND git repo are tagged with the same semver version for full traceability.

## Examples

### Example 1: Backend-only change

```bash
# Developer merges PR that changes backend code
git merge feat/new-api-endpoint
```

**Result:**
- ✅ Backend image built: `filoz-dealbot:sha-a1b2c3d`
- ❌ Web image skipped (no changes)
- 🚀 ArgoCD deploys backend to staging
- 📝 Release PR updated: `chore: release to production`
  - When the release PR is merged:
     - Will only promote backend image
     - Web stays at current version

### Example 2: Dependency update

```bash
# Developer updates dependencies
pnpm update
git commit -am "chore: update dependencies"
```

**Result:**
- ✅ Both images built (pnpm-lock.yaml changed)
- 🚀 ArgoCD deploys both to staging
- 📝 Release PR updated: `chore: release to production`
  - Includes changes for both apps

### Example 3: Hotfix (patch release)

```bash
# Developer merges a fix with a conventional commit (patch bump)
git commit -m "fix: resolve critical issue"
git push

# release-please updates the Release PR with a patch bump
# Developer merges the Release PR
```

**Result:**
- 🏷️ Images retagged as `v0.2.1`
- 🚀 Deployed to production as patch release

## Configuration

### Required GitHub Secrets

```
GITHUB_TOKEN: Automatically provided by GitHub Actions
```

No other secrets needed - ArgoCD Image Updater watches the GitHub Container Registry directly!

### ArgoCD Application and ImageUpdater Setup in FilOzone/infra

**Note:** Uses ArgoCD Image Updater v1.0.0+ CRD-based configuration. See [ArgoCD Image Updater Documentation](https://argocd-image-updater.readthedocs.io/en/stable/).

**Staging Setup** (watches ordered `sha-<run>-<sha>` tags):
```yaml
# Application definition
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dealbot-backend-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/filozone/dealbot
    targetRevision: main
    path: kustomize/base/backend
  destination:
    server: https://kubernetes.default.svc
    namespace: dealbot-staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
---
# ImageUpdater CRD for backend
apiVersion: argoproj.io/v1alpha1
kind: ImageUpdater
metadata:
  name: dealbot-backend-staging
  namespace: argocd
spec:
  applicationRef:
    name: dealbot-backend-staging
  images:
  - name: backend
    image: ghcr.io/filozone/dealbot-backend
    updateStrategy:
      type: alphabetical  # Formerly "name" in v0.x
    constraint:
      tagFilter: '^sha-[0-9]+-[0-9a-f]{40}$'
---
# Application definition for web
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dealbot-web-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/filozone/dealbot
    targetRevision: main
    path: kustomize/base/web
  destination:
    server: https://kubernetes.default.svc
    namespace: dealbot-staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
---
# ImageUpdater CRD for web
apiVersion: argoproj.io/v1alpha1
kind: ImageUpdater
metadata:
  name: dealbot-web-staging
  namespace: argocd
spec:
  applicationRef:
    name: dealbot-web-staging
  images:
  - name: web
    image: ghcr.io/filozone/dealbot-web
    updateStrategy:
      type: alphabetical  # Formerly "name" in v0.x
    constraint:
      tagFilter: '^sha-[0-9]+-[0-9a-f]{40}$'
```

**Production Setup** (watches semver tags, manual sync required):

**Important:** Production auto-sync is disabled initially. ImageUpdater will detect new semver tags and mark the Application as OutOfSync, but deployment requires manual approval.

```yaml
# Application definition
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dealbot-backend-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/filozone/dealbot
    targetRevision: main
    path: kustomize/base/backend
  destination:
    server: https://kubernetes.default.svc
    namespace: dealbot-prod
  syncPolicy:
    # Automated sync disabled for production safety
    syncOptions:
    - CreateNamespace=true
---
# ImageUpdater CRD for backend
apiVersion: argoproj.io/v1alpha1
kind: ImageUpdater
metadata:
  name: dealbot-backend-prod
  namespace: argocd
spec:
  applicationRef:
    name: dealbot-backend-prod
  images:
  - name: backend
    image: ghcr.io/filozone/dealbot-backend
    updateStrategy:
      type: semver
    constraint:
      semver: '>=0.1.0'
---
# Application definition for web
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: dealbot-web-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/filozone/dealbot
    targetRevision: main
    path: kustomize/base/web
  destination:
    server: https://kubernetes.default.svc
    namespace: dealbot-prod
  syncPolicy:
    # Automated sync disabled for production safety
    syncOptions:
    - CreateNamespace=true
---
# ImageUpdater CRD for web
apiVersion: argoproj.io/v1alpha1
kind: ImageUpdater
metadata:
  name: dealbot-web-prod
  namespace: argocd
spec:
  applicationRef:
    name: dealbot-web-prod
  images:
  - name: web
    image: ghcr.io/filozone/dealbot-web
    updateStrategy:
      type: semver
    constraint:
      semver: '>=0.1.0'
```

**Manual Sync Commands:**
```bash
# Via CLI
argocd app sync dealbot-backend-prod
argocd app sync dealbot-web-prod

# Or use the ArgoCD UI to review and sync
```

**To enable auto-sync later** (after confidence is established):
```yaml
syncPolicy:
  automated:
    prune: true
    selfHeal: true
```

## Benefits

✅ **Same image staging → prod** - Exact image tested in staging is promoted to prod

✅ **No manual builds** - Everything automated after merge

✅ **Simple promotion** - Just merge a PR to release

✅ **Selective releases** - Only changed apps are rebuilt and released

✅ **Version control** - Developer can adjust version bump before release

✅ **Audit trail** - Git tags and GitHub releases track all deployments

## Troubleshooting

### Release PR not created

**Check:**
- Did images actually build? (Path filter may have skipped them)
- Check workflow run in Actions tab

### Release failed

**Common issues:**
- SHA image doesn't exist in GitHub Container Registry
- Version already tagged
- GitHub token permissions insufficient

**Fix:**
- Check workflow logs for specific error
- Verify images in GitHub Container Registry (ghcr.io)
- Re-run failed workflow after fixing

### Want to skip a release

**Option 1:** Close the auto-generated PR without merging

**Option 2:** Merge later when ready to promote to prod

The images are already in staging - you control when they go to prod by merging the PR.
