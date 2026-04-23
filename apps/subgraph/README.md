# @dealbot/subgraph

A dealbot-owned Graph Protocol subgraph.

## What it indexes

- **PDPVerifier** — dataset lifecycle, piece add/remove, proving periods.
- **FilecoinWarmStorageService (FWSS)** — payer/service-provider metadata, `withIPFSIndexing` flag, `ipfsRootCID` per piece, service/payment termination.

## Local commands

```bash
# Typegen only (no WASM build)
pnpm codegen

# Full build for one network
pnpm build:mainnet
pnpm build:calibration

# Run matchstick tests
pnpm test
```

## Deploy

Requires `goldsky` CLI authenticated via `GOLDSKY_API_KEY`.

```bash
export VERSION=0.1.0
pnpm build:calibration
pnpm deploy:calibration

pnpm build:mainnet
pnpm deploy:mainnet
```

Goldsky slots (slugs TBD):

- `dealbot-mainnet/<version>` — mainnet
- `dealbot-calibration/<version>` — calibration
