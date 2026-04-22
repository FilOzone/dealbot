# Anonymous retrieval check

The `retrievalAnon` check probes an SP using pieces the dealbot did **not**
upload itself, to detect SPs that serve the dealbot's own deals well but
perform poorly on arbitrary storage. See
[issue #427](https://github.com/FilOzone/dealbot/issues/427) for the full
motivation.

This document describes the **piece selection** step. The subsequent piece
retrieval, CommP verification, CAR validation, IPNI lookup and `/ipfs` block
fetching follow the same shape as the basic retrieval check.

## Goals

1. **Uniform random** across the SP's entire active pool — not biased toward
   recent writes, specific payers, or specific sizes.
2. **Prefer `withIPFSIndexing` pieces** so CAR/IPNI validation has something
   meaningful to check, but still exercise non-indexed pieces so an SP can't
   optimise only its CAR corpus.
3. **Cover a realistic spread of piece sizes** — big enough for useful
   bandwidth measurements, not so big that SPs with only small deals are
   skipped.
4. **Respect termination signals** — exclude datasets with `isActive: false`,
   `fwssPayer == dealbot`, or `pdpPaymentEndEpoch <= currentEpoch`.
5. **Avoid immediate repeats** — don't retest a piece already tested in the
   last 500 anonymous retrievals.

## How it works

Every `Root` in the subgraph carries a `sampleKey = keccak256(id)` populated
once when the root is indexed. Because keccak256 is uniform over 256 bits and
independent of creation order, dataset, and size, `sampleKey` sorts roots
into a uniform random permutation that is stable across queries.

To draw a sample the backend:

1. Picks a **size bucket** by weighted random:

   | bucket | size range (raw bytes) | weight |
   |---|---|---|
   | `small`  | `[1, 64 MiB)`       | 0.2 |
   | `medium` | `[64 MiB, 1 GiB)`   | 0.5 |
   | `large`  | `[1 GiB, 32 GiB]`   | 0.3 |

2. Picks the **pool**: `withIPFSIndexing: true` with probability 0.8;
   otherwise no filter on `withIPFSIndexing` (both indexed and non-indexed
   pieces are eligible).

3. Generates 32 random bytes as `$sampleKey` and queries:

   ```graphql
   roots(
     first: 1
     orderBy: sampleKey
     orderDirection: asc
     where: {
       sampleKey_gte: $sampleKey
       removed: false
       rawSize_gte: $minSize
       rawSize_lte: $maxSize
       proofSet_: {
         fwssServiceProvider: $sp
         fwssPayer_not: $dealbotPayer
         isActive: true
         withIPFSIndexing: true   # only for the "indexed" pool query
       }
     }
   ) { rootId cid rawSize ipfsRootCID proofSet { setId withIPFSIndexing fwssPayer pdpPaymentEndEpoch } }
   ```

   The result is the root with the smallest `sampleKey ≥ $sampleKey` that
   satisfies the filters — a uniform random pick, in O(log N), with no
   `skip` ceiling.

4. Drops the pick if `pdpPaymentEndEpoch` has already passed the latest
   indexed block, or if its CID appears in the last 500 anonymous
   retrievals. On a drop, redraws once with a fresh `$sampleKey`.

5. If no piece survives, falls back through this order:

   1. Same bucket, opposite pool.
   2. Any bucket (`[0, 2^63-1]`), indexed pool.
   3. Any bucket, any pool.

   Each attempt uses a fresh `$sampleKey` and does up to two draws before
   moving on.

### Worked example

An SP with 50k active FWSS pieces is up for a probe.

1. Weighted random picks `medium`. Coin flip picks `indexed` pool.
2. `$sampleKey = 0x7fb3…c91e`. Subgraph returns the piece with the smallest
   `sampleKey ≥ $sampleKey` whose raw size is in `[64 MiB, 1 GiB)`, whose
   dataset is active, not paid by the dealbot, and marked
   `withIPFSIndexing`.
3. Its `pdpPaymentEndEpoch` is null and its CID isn't in the last 500 anon
   retrievals. Accepted.

Total: one subgraph call. For an SP whose `medium/indexed` pool is empty
(small, non-CAR-heavy SP) the selector redraws once, tries `medium/any`
twice, and will land in `any/indexed` or `any/any` within a couple hundred
milliseconds.

## Why a dedicated `sampleKey` field?

GraphQL has no native random operator. The two obvious alternatives both
break at the scales FOC expects:

- **`first: 1, skip: random(count)`** — The Graph caps `skip` at 5000. A
  single mainnet SP can already exceed this.
- **Ordering by `id`** — `Root.id = "<setId>-<rootId>"` is clustered by
  dataset age (and lexicographically quirky: `"1-10" < "1-2"`), so random
  `id_gte` picks skew heavily toward whichever `setId` prefix the random
  hex lands on.

A precomputed keccak hash sidesteps both: the sort is uniform, the lookup is
indexed (graph-node indexes every scalar automatically), and the field is
immutable — no maintenance cost on Root updates.

## What this replaces

The previous selector fetched the last 100 datasets × last 50 roots for an
SP, filtered out dealbot-owned and terminated ones client-side, and picked
from an in-memory pool with an "prefer IPFS-indexed" post-filter. That
implementation had three defects this design fixes:

1. An SP with more than 100 datasets, or more than 50 roots per dataset,
   was only ever probed on its newest corner of storage.
2. "Prefer IPFS-indexed" was applied after the pool was already truncated
   to the 100×50 recent window — indexed pieces outside that window were
   unreachable.
3. A cross-SP 500-piece dedup window was applied to a small per-SP pool, so
   it could starve out quickly for busy SPs.

The new selector also:

- Enforces size bucketing (`small / medium / large`), addressing rvagg's
  "big enough for bandwidth metrics, not so big as to exclude small SPs"
  concern.
- Moves `isActive` and `fwssPayer_not: dealbot` into the subgraph `where:`
  clause (one query round-trip instead of a client-side filter loop).
- Keeps `pdpPaymentEndEpoch` as a client-side check because GraphQL
  nullable-BigInt comparison semantics would require multiple queries.

## Tunables

All in `anon-piece-selector.service.ts`:

- `SIZE_BUCKETS` — bucket boundaries.
- `BUCKET_WEIGHTS` — bucket draw probabilities (must sum to 1).
- `IPFS_INDEXED_SAMPLE_RATE` — fraction of draws that start in the indexed
  pool (default 0.8).
- `RECENT_DEDUP_WINDOW` — how many recent anon retrievals are excluded
  (default 500).
