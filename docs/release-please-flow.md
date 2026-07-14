# release-please Flow

[release-please](https://github.com/googleapis/release-please) parses [Conventional Commits](https://www.conventionalcommits.org/) on `main` and maintains open Release PRs. Backend and web share the main release-please workflow; the subgraph has a separate release-please workflow so it can release independently. For the end-to-end promotion flow (build, staging, retag, production), see [release-process.md](release-process.md).

## How commits map to versions

| Commit shape                                       | Default bump |
|----------------------------------------------------|--------------|
| any type with `!` or a `BREAKING CHANGE:` footer   | major        |
| `feat:`                                            | minor        |
| `fix:` or any other configured `changelog-sections` type touching an app path | patch |

A configured non-`feat`, non-breaking commit (e.g. `chore`, `docs`, `perf`, `refactor`, `build`, `ci`, `test`, `style`, `revert`) on an app path resolves to a patch when it triggers a release. For edge cases, defer to the [release-please versioning docs](https://github.com/googleapis/release-please/blob/main/docs/customizing.md#versioning-strategies).

Only commits touching files under a package path affect that package's version. Backend and web are tagged independently as `backend-vX.Y.Z` and `web-vX.Y.Z`. Subgraph changes under `apps/subgraph/**` are handled by the separate subgraph release workflow and tagged as `subgraph-vX.Y.Z`.

## Commit message contract

release-please reads the **first line of the commit on `main`**. With the repository's default squash-merge subject, that first line is the PR title. Two safeguards keep that line parseable:

1. [pr-title.yml](../.github/workflows/pr-title.yml) validates the PR title with [`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request) against the action's default Conventional Commit types.
2. [release-please-config.json](../release-please-config.json) lists the same types under `changelog-sections` with `hidden: false`, so those types appear in the changelog instead of being dropped.

A type allowed by the PR title check but missing from `changelog-sections` will be ignored by release-please and produce no changelog entry.

Changing the squash subject before merge can prevent release-please from seeing the commit at all (see [Troubleshooting](#troubleshooting)).

## Configuration

- [release-please-config.json](../release-please-config.json): backend/web `changelog-sections`, package paths under `packages`, `release-type: node` set per package, `separate-pull-requests: false`.
- [.release-please-manifest.json](../.release-please-manifest.json): last released backend/web versions, updated by release-please.
- [release-please-subgraph-config.json](../release-please-subgraph-config.json): subgraph-only release-please config.
- [.release-please-subgraph-manifest.json](../.release-please-subgraph-manifest.json): last released subgraph version, updated by the subgraph release workflow.

## Hotfixes

Use `fix:` for a patch bump. Use `fix!:` with a `BREAKING CHANGE:` footer only when the fix is genuinely incompatible (this bumps major).

```
fix!: invalidate old session tokens

BREAKING CHANGE: clients must re-authenticate after upgrade.
```

## Troubleshooting

**No Release PR after merge.** Check in order:

1. The merge commit's first line on `main` is valid Conventional Commits. A non-conventional or unknown-type subject can cause release-please to log `No user facing commits found … skipping`.
2. Verify the commit type appears in the relevant release-please config's `changelog-sections`. If the PR title check allowed a type that is not in the config, release-please drops it.
3. The diff touched a package path. Backend/web releases require `apps/backend/**` or `apps/web/**`; subgraph releases require `apps/subgraph/**`.
4. If everything above checks out, the commit may have landed in an existing open Release PR rather than opening a new one. Look for the open Release PR.

**Wrong version bump.** Close the Release PR, push a corrective commit, and let release-please reopen it.

**Re-run the release workflow** (only when images for the target commit already exist in GHCR):

```bash
gh workflow run release-please.yml
```

For subgraph releases:

```bash
gh workflow run release-subgraph.yml
```
