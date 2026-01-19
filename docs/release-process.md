# Automated Release Process

This repository uses an automated GitOps release workflow to promote changes from staging to production.

Related docs:
- [release-please-flow.md](release-please-flow.md) for release-please details and troubleshooting
- [infra.md](infra.md) for ArgoCD/Kustomize integration in FilOzone/infra

## Overview

```
Code merged to main
  ↓
Build Docker images (e.g., sha-<sha> and sha-<run>-<sha>)
  ↓
ArgoCD auto-deploys to STAGING (watches ordered tags via Image Updater)
  ↓
release-please opens/updates Release PR (title includes component + version)
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

### 1. Merge to Main

When you merge a PR to `main`, the release pipeline starts.

### 2. Build Docker Images ([.github/workflows/docker-build.yml](../.github/workflows/docker-build.yml))

- Detects which apps changed (backend, web, or both)
- Builds images only for changed apps
- Tags:
  - `sha-<git-sha>` (stable pointer used for promotion/retagging)
  - `sha-<run-number>-<git-sha>` (monotonic tag used for staging)
- Example: `ghcr.io/filozone/dealbot-backend:sha-1234-<sha>`

### 3. ArgoCD Deploys to Staging

- ArgoCD Image Updater watches ordered `sha-<run>-<sha>` tags in staging
- Automatically deploys new images to staging

### 4. release-please Opens/Updates the Release PR

- release-please opens/updates a single PR titled like `chore: release to production (backend 0.2.0, web 0.5.0)`, listing all components that have changes
- Includes per-app `package.json` version bumps and changelog entries
- See [release-please-flow.md](release-please-flow.md) for versioning details

### 5. Review and Merge the Release PR

- Review the auto-created PR
- If the bump looks wrong, update commits and let release-please refresh the PR
- Merge the PR when ready to promote to production

### 6. Retag Images with Semver

- The release workflow retags the same `sha-<sha>` images as `vX.Y.Z`
- Only apps with a release are retagged

### 7. ArgoCD Detects New Version in Production

- Image Updater sees the new semver tags and marks apps OutOfSync

### 8. Manual Approval to Sync Production

- Sync via ArgoCD UI or CLI (`argocd app sync dealbot-backend-prod`)

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

## References

- [release-please-flow.md](release-please-flow.md) - release-please behavior and troubleshooting
- [infra.md](infra.md) - infra integration and where ArgoCD/Image Updater config lives
- [.github/workflows/docker-build.yml](../.github/workflows/docker-build.yml)
- [.github/workflows/release-please.yml](../.github/workflows/release-please.yml)
