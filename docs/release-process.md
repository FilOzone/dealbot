# Release Process

Dealbot uses [release-please](https://github.com/googleapis/release-please) to drive semver releases from [Conventional Commits](https://www.conventionalcommits.org/), and ArgoCD Image Updater to promote those releases into Kubernetes. For release-please mechanics (commit parsing, version bumps, troubleshooting) see [release-please-flow.md](release-please-flow.md). For container images, manifests, and runtime topology see [deployment.md](deployment.md). For ingress, egress, persistence, secrets, and observability expectations see [infra.md](infra.md).

## Flow

```
PR merged to main, matching docker-build path filters (apps/backend/**, apps/web/**, pnpm-lock.yaml, pnpm-workspace.yaml)
  → Docker build tags image as sha-<sha> and sha-<run>-<sha>
  → Image Updater promotes sha-<run>-<sha> to the staging environment
  → release-please opens or updates a Release PR with bumped versions and changelogs
  → Release PR merged                       (← human release gate)
  → Release workflow retags sha-<sha> → vX.Y.Z
  → Image Updater promotes vX.Y.Z to the production environment
```

Both staging and production sync automatically. Image Updater writes the new tag back to the operating environment's manifests, and ArgoCD reconciles within a few minutes. Merging the Release PR is the release-cut gate for production semver images; retag and promotion run without further approval. An operator can still pause or sync manually per environment (see [Operating the release](#operating-the-release)).

Image-build scope and release scope differ. Changes under `apps/backend/**`, `apps/web/**`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml` can build app images. Only commits that touch an app's path (`apps/backend` or `apps/web`) affect that app's release-please version.

## Tags

Git tags and container tags use different shapes:

| Tag                     | Producer                | Consumed by               |
|-------------------------|-------------------------|---------------------------|
| `backend-vX.Y.Z` / `web-vX.Y.Z` (git) | release-please | GitHub Releases, changelogs |
| `sha-<sha>` (image)            | docker-build on `main`         | retag step                |
| `sha-<run>-<sha>` (image)      | docker-build on `main`         | staging Image Updater     |
| `pre-release-<sha>` (image)    | docker-build on `pre-release`  | opt-in canary environments |
| `vX.Y.Z` (image)               | release-please workflow        | production Image Updater  |

Apps are versioned independently. A commit that touches only one app produces a Release PR entry, git tag, and retagged image for only that app.

Workflows: [.github/workflows/docker-build.yml](../.github/workflows/docker-build.yml), [.github/workflows/release-please.yml](../.github/workflows/release-please.yml).

## Operating the release

1. Merge feature PRs to `main` using a Conventional Commit title (validated by [pr-title.yml](../.github/workflows/pr-title.yml)).
2. Staging picks up the new build automatically.
3. When ready to ship, merge the open Release PR.
4. Production picks up the new semver tag automatically.

If a release needs to be skipped, leave the Release PR open. Subsequent merges accumulate into it. To hold a release after the Release PR merges (e.g. a canary failed, on-call paged), pause auto-sync for that environment in ArgoCD. While paused, promote by syncing that environment manually via UI or CLI.
