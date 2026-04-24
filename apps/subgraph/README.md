# @dealbot/subgraph

A dealbot-owned Graph Protocol subgraph indexing the Filecoin PDP contracts. Deployed to Goldsky and consumed exclusively by `apps/backend` via the `SUBGRAPH_ENDPOINT` env var.

## What it indexes

- **PDPVerifier** — dataset lifecycle, piece add/remove, proving periods.
- **FilecoinWarmStorageService (FWSS)** — payer/service-provider metadata, `withIPFSIndexing` flag, `ipfsRootCID` per piece, service/payment termination.

## Why it exists

The dealbot backend needs three queries (see `apps/backend/src/subgraph/queries.ts`):

1. `GET_SUBGRAPH_META` — latest indexed block.
2. `GET_PROVIDERS_WITH_DATASETS` — overdue proving-period detection.
3. `GET_FWSS_CANDIDATE_PIECES` — anonymous-retrieval piece selection (motivated by [FilOzone/dealbot#427](https://github.com/FilOzone/dealbot/issues/427)).

The code originated as a fork of [FilOzone/pdp-explorer#100](https://github.com/FilOzone/pdp-explorer/pull/100). Forking lets us trim the schema and handlers to exactly what dealbot queries, and deploy on our own cadence.

## Why this package is an outlier

Subgraph mappings compile to WASM via AssemblyScript. Despite the `.ts` extension, AssemblyScript is **not** TypeScript:

- No Biome/Prettier — the parser trips on AssemblyScript primitives (`u8`, `u32`, `i32`).
- Tests use `matchstick-as`, not Vitest.
- `tsconfig.json` extends `@graphprotocol/graph-ts`'s base config, not the monorepo's.
- Build is `graph codegen && graph build`, not `tsc` or `vite build`.

The package is intentionally isolated from the root `pnpm test` / `pnpm build` scripts — its lifecycle is "rebuild and redeploy to Goldsky when mappings change", not "build on every PR".

## Contract addresses

| Network | Contract | Address | Start block |
|---|---|---|---|
| mainnet (`filecoin`) | PDPVerifier | `0xBADd0B92C1c71d02E7d520f64c0876538fa2557F` | 5441432 |
| mainnet (`filecoin`) | FilecoinWarmStorageService | `0x8408502033C418E1bbC97cE9ac48E5528F371A9f` | 5459617 |
| calibration (`filecoin-testnet`) | PDPVerifier | `0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C` | 3140755 |
| calibration (`filecoin-testnet`) | FilecoinWarmStorageService | `0x02925630df557F957f70E112bA06e50965417CA0` | 3141276 |

Maintained in `networks.json`. Editing `subgraph.yaml` manually is usually wrong — run `pnpm build:mainnet` or `pnpm build:calibration` which applies `networks.json` via `graph build --network <name>`.

Note: `graph build --network X` rewrites `subgraph.yaml` **in place** with the chosen network's values. The committed version is mainnet-default — after a `build:calibration`, re-run `build:mainnet` before committing to avoid leaking calibration values into the mainnet manifest.

## Local commands

```bash
# Typegen only (no WASM build)
pnpm --filter @dealbot/subgraph codegen

# Full build for one network
pnpm --filter @dealbot/subgraph build:mainnet
pnpm --filter @dealbot/subgraph build:calibration

# Run matchstick tests
pnpm --filter @dealbot/subgraph test
```

## Deploy

Requires `goldsky` CLI authenticated via `GOLDSKY_API_KEY`.

```bash
export VERSION=0.1.0
pnpm --filter @dealbot/subgraph build:calibration
pnpm --filter @dealbot/subgraph deploy:calibration

pnpm --filter @dealbot/subgraph build:mainnet
pnpm --filter @dealbot/subgraph deploy:mainnet
```

Goldsky slots (slugs TBD):

- `dealbot-mainnet/<version>` — mainnet
- `dealbot-calibration/<version>` — calibration

After deploy, update `SUBGRAPH_ENDPOINT` in the backend env to the new `/gn` URL.
