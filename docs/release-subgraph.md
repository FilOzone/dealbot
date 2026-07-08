# Subgraph Release Checklist

Source of truth for releasing and deploying [`apps/subgraph/`](../apps/subgraph/).

The dealbot subgraph is versioned independently from `apps/backend` and `apps/web`. Those two go through a release process as described in [release-process.md](release-process.md). The subgraph uses its own release-please workflow and is published to [Goldsky](https://goldsky.com/) on its own cadence following the steps below.

When cutting a release, you may copy the checklist into a new GitHub issue titled `Release subgraph vX.Y.Z` and tick the boxes as you go. The structure mirrors [filecoin-pay-explorer's release template](https://github.com/FilOzone/filecoin-pay-explorer/blob/main/.github/ISSUE_TEMPLATE/release.md).

## Notes

- Dealbot's backend consumes the subgraph at a `prod`-tagged URL (e.g. `.../dealbot-mainnet/prod/gn`). Re-tagging is what actually promotes a new version to production (no backend redeploy required).
- The release workflow deploys immutable Goldsky versions only. Goldsky `staging` and `prod` tags are moved manually after the new version finishes indexing and is validated.
- This checklist assumes a **backward-compatible** change. For a breaking change see [Breaking changes](#breaking-changes) at the bottom.

## 1. Merge the subgraph Release PR

Subgraph releases are managed by the separate [`release-subgraph.yml`](../.github/workflows/release-subgraph.yml) workflow, using [`release-please-subgraph-config.json`](../release-please-subgraph-config.json) and [`apps/subgraph/CHANGELOG.md`](../apps/subgraph/CHANGELOG.md).

When a conventional commit touching `apps/subgraph/**` lands on `main`, release-please opens or updates a subgraph-only Release PR.

- [ ] Review the subgraph Release PR
- [ ] Confirm the semver bump is correct: additive → minor, fix → patch, breaking → major
- [ ] Merge the subgraph Release PR

Merging the Release PR creates the GitHub Release and tag `subgraph-vX.Y.Z`. The `subgraph-` prefix disambiguates from backend and web release tags.

## 2. Confirm immutable Goldsky deployment

The same release workflow deploys the released version to Goldsky for both networks:

- `dealbot-calibration/X.Y.Z`
- `dealbot-mainnet/X.Y.Z`

- [ ] GitHub Release created with tag `subgraph-vX.Y.Z`
- [ ] `release-subgraph.yml` deployed `dealbot-calibration/X.Y.Z`
- [ ] `release-subgraph.yml` deployed `dealbot-mainnet/X.Y.Z`

If the automated deploy fails after the GitHub Release is created, rerun the failed `release-subgraph.yml` job from GitHub Actions. Manual fallback commands are:

```bash
export VERSION=X.Y.Z   # no v prefix; used as the Goldsky version segment

pnpm build:calibration
pnpm deploy:calibration

pnpm build:mainnet
pnpm deploy:mainnet
```

## 3. Await subgraph indexing

- [ ] Received confirmation email that `dealbot-calibration` finished indexing
- [ ] Received confirmation email that `dealbot-mainnet` finished indexing

## 4. Smoke-test the candidate in staging

Point dealbot staging at the new versioned URL. The cleanest way is via a `staging` tag so the staging backend's config can stay stable:

```bash
NEW_RELEASE_VERSION="X.Y.Z"
CURRENT_VERSION="X.Y.Z"       # version currently tagged as `staging` or `prod`

for network in calibration mainnet; do
  goldsky subgraph tag delete dealbot-$network/$CURRENT_VERSION --tag staging 2>/dev/null || true
  goldsky subgraph tag create dealbot-$network/$NEW_RELEASE_VERSION --tag staging
done
```

- [ ] `dealbot-mainnet/$NEW_RELEASE_VERSION` tagged as `staging`
- [ ] `dealbot-calibration/$NEW_RELEASE_VERSION` tagged as `staging`
- [ ] Dealbot staging backend's subgraph-dependent checks succeed against the new subgraph
- [ ] No new errors in dealbot staging logs

## 5. Promote subgraphs to `prod`

> [!NOTE]
> Re-tagging as `prod` below switches the **production** dealbot backend over to the new subgraph version. Do this only when you're ready to take it live.

```bash
NEW_RELEASE_VERSION="X.Y.Z"
CURRENT_VERSION="X.Y.Z"       # version currently tagged as `prod`

for network in calibration mainnet; do
  # `tag create` errors if `prod` already points at another version, so we
  # delete first. The window between the two calls is sub-second; consumers
  # querying the `prod` URL in that window will get an error.
  goldsky subgraph tag delete dealbot-$network/$CURRENT_VERSION --tag prod 2>/dev/null || true
  goldsky subgraph tag create dealbot-$network/$NEW_RELEASE_VERSION --tag prod
done
```

- [ ] `dealbot-mainnet` tagged as `prod`
- [ ] `dealbot-calibration` tagged as `prod`

## 6. Verify production

- [ ] Dealbot production backend's subgraph-dependent checks are healthy
- [ ] No regressions in production metrics or dashboards

## 7. Wrap-up

- [ ] Announce the release in `#fil-foc`
- [ ] Capture any improvements needed for next time
- [ ] Close this issue

---

## Breaking changes

When the schema or entity shape changes in a way the current backend can't read, the order changes — re-tagging `prod` first would take the backend down:

1. Steps 1–4 as above (cut & deploy the new version, wait for indexing).
2. Land the backend changes that consume the new shape, configured to read from the new **versioned** URL (not `prod`). Deploy to dealbot staging and validate end-to-end against `vX.Y.Z`.
3. Once dealbot production is on a backend release that understands the new shape (either both shapes during a migration, or new-only), proceed to step 6 to re-tag `prod`.
4. Rollback: re-tag the previous subgraph version back to `prod`. The `prod` tag is the rollback lever — a single Goldsky API call, no backend redeploy required.
