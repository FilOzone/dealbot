# Environment Variables Reference

This document provides a comprehensive guide to all environment variables used by the Dealbot. Understanding these variables is essential for proper configuration in development, testing, and production environments.

## Multi-Network Support

Dealbot drives one or more Filecoin networks from a **single process**. The active set is controlled by the [`NETWORKS`](#networks) variable, and every network-scoped variable is namespaced with the UPPERCASE network name.

```bash
# Run Dealbot against both networks from the same instance
NETWORKS=calibration,mainnet

# Credentials and endpoints are per-network (never shared)
CALIBRATION_WALLET_PRIVATE_KEY=0xabc...
CALIBRATION_RPC_URL=https://api.calibration.node.glif.io/rpc/v1
MAINNET_WALLET_PRIVATE_KEY=0xdef...
MAINNET_RPC_URL=https://api.node.glif.io/rpc/v1

# Shared tuning: set once unprefixed, applies to every network
DEAL_JOB_TIMEOUT_SECONDS=360
MAINTENANCE_WINDOWS_UTC=07:00,22:00

# ...and override per network only where they differ
CALIBRATION_DEALS_PER_SP_PER_HOUR=2
MAINNET_DEALS_PER_SP_PER_HOUR=1
```

**Rules**

- **Resolution precedence (per-network vars).** Each network resolves a variable as `<NETWORK>_<VAR>` (per-network override) → `<VAR>` (unprefixed shared value) → built-in default. Set a value once unprefixed to share it across every active network, and add a `<NETWORK>_` override only where a network differs.
- **Chain-specific vars never inherit.** Credentials, chain endpoints, and chain-local identifiers must be set with a prefix and do not read the unprefixed slot: `WALLET_ADDRESS`, `WALLET_PRIVATE_KEY`, `SESSION_KEY_PRIVATE_KEY`, `RPC_URL`, `PDP_SUBGRAPH_ENDPOINT`, `DEALBOT_DATASET_VERSION`, `BLOCKED_SP_IDS`, `BLOCKED_SP_ADDRESSES`.
- **Process-global vars.** Database, HTTP ports, ClickHouse, and pg-boss scheduler settings apply to the whole process and have no per-network form.
- **Validation.** Both the unprefixed shared value and each `<NETWORK>_` override are validated against the same rules at startup. Only networks listed in `NETWORKS` are required; variables for inactive networks are ignored, so you can keep a `MAINNET_*` block commented out until you are ready.
- **Wallet vs. session key.** Each active network must provide either `<NETWORK>_WALLET_PRIVATE_KEY` or `<NETWORK>_SESSION_KEY_PRIVATE_KEY`. When both are present the session key takes precedence (see [`docs/runbooks/wallet-and-session-keys.md`](./runbooks/wallet-and-session-keys.md)).
- **Supported prefixes.** `CALIBRATION_*`, `MAINNET_*`. Additional networks can be added by extending `SUPPORTED_NETWORKS` in the codebase.

## Quick Reference

| Category                                  | Variables                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Application](#application-configuration) | `NODE_ENV`, `DEALBOT_PORT`, `DEALBOT_HOST`, `DEALBOT_RUN_MODE`, `DEALBOT_METRICS_PORT`, `DEALBOT_METRICS_HOST`, `DEALBOT_ALLOWED_ORIGINS`, `ENABLE_DEV_MODE`, `DEALBOT_API_PUBLIC_URL`, `DEALBOT_PROBE_LOCATION` |
| [Database](#database-configuration)       | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_POOL_MAX`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`                                                 |
| [Per-Network](#per-network-configuration) | `<NET>_WALLET_ADDRESS`, `<NET>_WALLET_PRIVATE_KEY`, `<NET>_SESSION_KEY_PRIVATE_KEY`, `<NET>_RPC_URL`, `<NET>_RPC_REQUEST_TIMEOUT_MS`, `<NET>_CHECK_DATASET_CREATION_FEES`, `<NET>_USE_ONLY_APPROVED_PROVIDERS`, `<NET>_PDP_SUBGRAPH_ENDPOINT`, `<NET>_DEALBOT_DATASET_VERSION`, `<NET>_MIN_NUM_DATASETS_FOR_CHECKS`                                           |
| [Per-Network Scheduling](#per-network-scheduling) | `<NET>_DEALS_PER_SP_PER_HOUR`, `<NET>_DEAL_JOB_TIMEOUT_SECONDS`, `<NET>_RETRIEVALS_PER_SP_PER_HOUR`, `<NET>_RETRIEVAL_JOB_TIMEOUT_SECONDS`, `<NET>_DATASET_CREATIONS_PER_SP_PER_HOUR`, `<NET>_DATA_SET_CREATION_JOB_TIMEOUT_SECONDS`, `<NET>_DATASET_LIFECYCLE_CHECK_ENABLED`, `<NET>_DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR`, `<NET>_DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`, `<NET>_PULL_CHECKS_PER_SP_PER_HOUR`, `<NET>_PULL_CHECK_JOB_TIMEOUT_SECONDS`, `<NET>_PULL_CHECK_POLL_INTERVAL_SECONDS`, `<NET>_PULL_PIECE_CLEANUP_INTERVAL_SECONDS`, `<NET>_PROVIDERS_REFRESH_INTERVAL_SECONDS`, `<NET>_DATA_RETENTION_POLL_INTERVAL_SECONDS`, `<NET>_MAINTENANCE_WINDOWS_UTC`, `<NET>_MAINTENANCE_WINDOW_MINUTES`, `<NET>_BLOCKED_SP_IDS`, `<NET>_BLOCKED_SP_ADDRESSES`, `<NET>_MAX_DATASET_STORAGE_SIZE_BYTES`, `<NET>_TARGET_DATASET_STORAGE_SIZE_BYTES`, `<NET>_PIECE_CLEANUP_PER_SP_PER_HOUR`, `<NET>_MAX_PIECE_CLEANUP_RUNTIME_SECONDS` |
| [Jobs (pg-boss)](#jobs-pg-boss)           | `DEALBOT_PGBOSS_SCHEDULER_ENABLED`, `DEALBOT_PGBOSS_POOL_MAX`, `JOB_SCHEDULER_POLL_SECONDS`, `JOB_WORKER_POLL_SECONDS`, `PG_BOSS_LOCAL_CONCURRENCY`, `JOB_CATCHUP_MAX_ENQUEUE`, `JOB_SCHEDULE_PHASE_SECONDS`, `JOB_ENQUEUE_JITTER_SECONDS`, `SHUTDOWN_FINAL_SCRAPE_DELAY_SECONDS`, `IPFS_BLOCK_FETCH_CONCURRENCY` |
| [Pull Check](#pull-check-configuration)   | `PULL_CHECK_PIECE_SIZE_BYTES`, `PULL_PIECE_MAX_CONCURRENT_STREAMS`, `PULL_PIECE_MAX_STREAMS_PER_CID` |
| [ClickHouse](#clickhouse-configuration)   | `CLICKHOUSE_URL`, `CLICKHOUSE_BATCH_SIZE`, `CLICKHOUSE_FLUSH_INTERVAL_MS`, `CLICKHOUSE_MAX_BUFFER_SIZE`                                                      |
| [Dataset](#dataset-configuration)         | `DEALBOT_LOCAL_DATASETS_PATH`, `RANDOM_PIECE_SIZES`                                                                                                          |
| [Timeouts](#timeout-configuration)        | `CONNECT_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `HTTP2_REQUEST_TIMEOUT_MS`, `IPNI_VERIFICATION_TIMEOUT_MS`, `IPNI_VERIFICATION_POLLING_MS`                   |
| [Prometheus Metrics](#prometheus-metrics-configuration) | `PROMETHEUS_WALLET_BALANCE_TTL_SECONDS`, `PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS`                   |
| [Web Frontend](#web-frontend)             | `VITE_API_BASE_URL`, `VITE_PLAUSIBLE_DATA_DOMAIN`, `DEALBOT_API_BASE_URL`                                                                                    |

> **Legend.** `<NET>` is the uppercase network name (`CALIBRATION`, `MAINNET`).

---

## Application Configuration

### `NODE_ENV`

- **Type**: `string`
- **Required**: No
- **Default**: `development`
- **Valid values**: `development`, `production`

**Role**: Determines the runtime environment mode. Affects logging verbosity, error handling, and optimization behaviors.

**When to update**:

- Set to `production` when deploying to production environments
- Keep as `development` for local development

#### NOTE -

    Database migrations won't run if `NODE_ENV` is set to `development`. TypeORM handles entity schema changes automatically.

---

### `DEALBOT_PORT`

- **Type**: `number`
- **Required**: No
- **Default**: `3000` (config) / `8080` (recommended in .env.example)

**Role**: The port on which the Dealbot backend HTTP server listens.

**When to update**:

- When the default port conflicts with another service
- When deploying behind a reverse proxy that expects a specific port
- When running multiple Dealbot instances on the same machine

**Example scenario**: Running Dealbot alongside another service that uses port 8080:

```bash
DEALBOT_PORT=9000
```

---

### `DEALBOT_RUN_MODE`

- **Type**: `string`
- **Required**: No
- **Default**: `both`
- **Valid values**: `api`, `worker`, `both`

**Role**: Controls which components run in the process:

- `api`: API server + scheduler (no workers)
- `worker`: workers + `/metrics` only (no API)
- `both`: API server + scheduler + workers

**Example**:

```bash
DEALBOT_RUN_MODE=worker
```

---

### `DEALBOT_METRICS_PORT`

- **Type**: `number`
- **Required**: No
- **Default**: `9090`

**Role**: Port used for the metrics-only HTTP server when `DEALBOT_RUN_MODE=worker`.

**Example**:

```bash
DEALBOT_METRICS_PORT=9090
```

---

### `DEALBOT_METRICS_HOST`

- **Type**: `string`
- **Required**: No
- **Default**: `0.0.0.0`

**Role**: Host/interface used for the metrics-only HTTP server when `DEALBOT_RUN_MODE=worker`.

**Example**:

```bash
DEALBOT_METRICS_HOST=0.0.0.0
```

---

### `DEALBOT_HOST`

- **Type**: `string`
- **Required**: No
- **Default**: `127.0.0.1` (localhost only)

**Role**: The network interface/host the server binds to.

**When to update**:

- Set to `0.0.0.0` to accept connections from any network interface (required for containerized deployments)
- Keep as `127.0.0.1` for local-only access during development

**Example scenario**: Deploying in Kubernetes where the service needs to be accessible from other pods:

```bash
DEALBOT_HOST=0.0.0.0
```

---

### `DEALBOT_ALLOWED_ORIGINS`

- **Type**: `string` (comma-separated URLs)
- **Required**: No
- **Default**: Empty (CORS disabled)

**Role**: Configures Cross-Origin Resource Sharing (CORS) to allow the web frontend to make API requests to the backend.

**When to update**:

- When the web frontend URL changes
- When adding additional frontend deployments (staging, preview environments)
- When developing locally with a different frontend port

**Example scenario**: Allowing both local development and a staging frontend:

```bash
DEALBOT_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://staging.dealbot.example.com
```

---

### `ENABLE_DEV_MODE`

- **Type**: `boolean`
- **Required**: No
- **Default**: `false`

**Role**: Enables the `/api/dev/*` endpoints for manually triggering deals and retrievals during local development.

**When to update**:

- Set to `true` only for local development or isolated test environments
- Keep as `false` for any deployed Dealbot instance unless separate gating or security measures are in place

**Security warning**: This flag exposes unauthenticated dev-only endpoints that bypass normal scheduling and safeguards. Do not enable in production or shared environments without additional access controls.

**Example**:

```bash
ENABLE_DEV_MODE=true
```

---

### `DEALBOT_API_PUBLIC_URL`

- **Type**: `string` (URL)
- **Required**: No
- **Default**: Empty (falls back to `http://<DEALBOT_HOST>:<DEALBOT_PORT>`)

**Role**: Publicly reachable base URL for the Dealbot API. Used to construct hosted-piece source URLs that storage providers can fetch during pull checks. When unset, Dealbot constructs the URL from `DEALBOT_HOST` and `DEALBOT_PORT`, which may not be routable from external SP nodes.

**When to update**:

- Set in production when the Dealbot API is behind a reverse proxy or load balancer
- Required for pull-check functionality to work correctly when SPs cannot reach the internal host/port directly

**Example**:

```bash
DEALBOT_API_PUBLIC_URL=https://dealbot.example.com
```

---

### `DEALBOT_PROBE_LOCATION`

- **Type**: `string`
- **Required**: No
- **Default**: `unknown`

**Role**: A label identifying the geographic or logical location of this Dealbot instance. Attached to metrics and check results to distinguish probes running in different regions or datacenters.

**Example**:

```bash
DEALBOT_PROBE_LOCATION=us-east-1
```

---

## Database Configuration

### `DATABASE_HOST`

- **Type**: `string`
- **Required**: Yes

**Role**: Hostname or IP address of the PostgreSQL database server.

**When to update**:

- When connecting to a remote database instead of localhost
- When using a managed database service (AWS RDS, Cloud SQL, etc.)
- When the database is in a different Kubernetes namespace or cluster

**Example scenarios**:

```bash
# Local development
DATABASE_HOST=localhost

# Kubernetes internal service
DATABASE_HOST=dealbot-postgres.dealbot.svc.cluster.local

# Managed database
DATABASE_HOST=dealbot-db.abc123.us-east-1.rds.amazonaws.com
```

---

### `DATABASE_PORT`

- **Type**: `number`
- **Required**: No
- **Default**: `5432`

**Role**: Port number for the PostgreSQL connection.

**When to update**:

- When using a non-standard PostgreSQL port
- When connecting through a port-forwarded tunnel

---

### `DATABASE_POOL_MAX`

- **Type**: `number`
- **Required**: No
- **Default**: `1`

**Role**: Maximum number of connections in the TypeORM pool per process.
Lower this when using a session-mode pooler with a low `pool_size`.

**Example**:

```bash
DATABASE_POOL_MAX=1
```

---

### `DATABASE_USER`

- **Type**: `string`
- **Required**: Yes

**Role**: Username for PostgreSQL authentication.

**When to update**:

- When using a different database user for security isolation
- When connecting to a managed database with specific credentials

---

### `DATABASE_PASSWORD`

- **Type**: `string`
- **Required**: Yes
- **Security**: **SENSITIVE** - Never commit to version control

**Role**: Password for PostgreSQL authentication.

**When to update**:

- When rotating database credentials
- When connecting to a different database environment

**Note**: The bundled local PostgreSQL uses `dealbot_password` by default. Only set this when using an external database or a non-default password.

---

### `DATABASE_NAME`

- **Type**: `string`
- **Required**: Yes
- **Default**: `filecoin_dealbot`

**Role**: Name of the PostgreSQL database to connect to.

**When to update**:

- When using a different database name for environment isolation (e.g., `postgres`, `dealbot_staging`, `dealbot_prod`)

---

## Network Selection

### `NETWORKS`

- **Type**: `string` (comma-separated list)
- **Required**: No
- **Default**: `calibration`
- **Valid values (per entry)**: `mainnet`, `calibration`

**Role**: Selects which Filecoin networks the instance drives. Every active network is validated independently at startup; inactive networks have their `<NET>_*` variables ignored entirely.

**Examples**:

```bash
# Single network (default)
NETWORKS=calibration

# Multi-network instance
NETWORKS=calibration,mainnet
```

**⚠️ Warning**: Adding `mainnet` to `NETWORKS` will cause the instance to spend real FIL/USDFC for every scheduled job. Ensure the configured wallet is funded and rate limits are reviewed before enabling.

---

## Per-Network Configuration

Every variable below must be prefixed with the uppercase network name (e.g. `CALIBRATION_`, `MAINNET_`). Values only apply when the corresponding network is listed in [`NETWORKS`](#networks).

### `<NET>_WALLET_ADDRESS`

- **Type**: `string` (Ethereum-style address)
- **Required**: No (defaults to the zero address)
- **Security**: Public, but should match `<NET>_WALLET_PRIVATE_KEY` or be the signer registered against `<NET>_SESSION_KEY_PRIVATE_KEY`.

**Role**: The FEVM address used for signing transactions and paying for storage deals on the given network.

**Example**:

```bash
CALIBRATION_WALLET_ADDRESS=0x1234567890abcdef1234567890abcdef12345678
```

---

### `<NET>_WALLET_PRIVATE_KEY`

- **Type**: `string` (0x-prefixed hex)
- **Required**: One of `<NET>_WALLET_PRIVATE_KEY` or `<NET>_SESSION_KEY_PRIVATE_KEY` is required for every active network. Both may be set, in which case the session key takes precedence.
- **Security**: **HIGHLY SENSITIVE** — never commit to version control; use Kubernetes Secrets or an equivalent secrets manager.

**Role**: Private key for signing blockchain transactions on this network. Required in direct-key mode. Ignored when a session key is provided.

---

### `<NET>_SESSION_KEY_PRIVATE_KEY`

- **Type**: `string` (0x-prefixed hex)
- **Required**: See `<NET>_WALLET_PRIVATE_KEY` above.
- **Security**: **HIGHLY SENSITIVE**.

**Role**: When set, Dealbot uses session-key authentication on this network. The session key must be registered on the `SessionKeyRegistry` contract from `<NET>_WALLET_ADDRESS` (typically a Safe multisig). Storage operations (create dataset, add pieces) are signed with this key instead of `<NET>_WALLET_PRIVATE_KEY`.

Session keys are scoped (only storage operations, not deposits or withdrawals) and time-limited (expiry set during registration). See [runbooks/wallet-and-session-keys.md](runbooks/wallet-and-session-keys.md) for the full setup process.

---

### `<NET>_RPC_URL`

- **Type**: `string` (HTTP/HTTPS URL)
- **Required**: No
- **Default**: Empty (SDK falls back to its built-in default public RPC for the network)

**Role**: Custom Filecoin RPC endpoint. When set, all on-chain calls (Synapse SDK, viem) for this network use the configured endpoint. Use an authenticated endpoint to avoid rate-limiting on shared public infrastructure.

Providers like Glif/Chain.Love accept the API key as a query parameter:

```bash
CALIBRATION_RPC_URL=https://filecoin.chain.love/rpc/v1?token=YOUR_API_KEY
```

**Security**: Treat as a secret if the URL contains an API key.

---

### `<NET>_CHECK_DATASET_CREATION_FEES`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: When enabled, validates that the network's wallet has sufficient balance to cover dataset-creation fees plus 100 GiB of storage costs before creating a new dataset.

**When to update**:

- Set to `false` to skip the balance check (e.g. for CI/test environments where insufficient balance is expected).

---

### `<NET>_USE_ONLY_APPROVED_PROVIDERS`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: Restricts deal-making to Filecoin Warm Storage Service (FWSS) approved storage providers for the network.

**When to update**:

- Set to `false` to test against any provider that supports the `PDP` product in `ServiceProviderRegistry`.

---

### `<NET>_PDP_SUBGRAPH_ENDPOINT`

- **Type**: `string` (URL)
- **Required**: No
- **Default**: Empty (feature disabled for this network)

**Role**: The Graph API endpoint for querying PDP (Proof of Data Possession) subgraph data for this network. Used to retrieve data-retention information for provider datasets.

**Example**:

```bash
CALIBRATION_PDP_SUBGRAPH_ENDPOINT=https://api.thegraph.com/subgraphs/filecoin/pdp
```

---

### `<NET>_MIN_NUM_DATASETS_FOR_CHECKS`

- **Type**: `number` (integer, ≥ 1)
- **Required**: No
- **Default**: `1`

**Role**: Minimum number of datasets provisioned per storage provider before running checks on this network. When > 1, the `data_set_creation` job is responsible for provisioning any additional datasets.

---

### `<NET>_DEALBOT_DATASET_VERSION`

- **Type**: `string`
- **Required**: No
- **Default**: Not set (no versioning)

**Role**: Tags newly created datasets with a version label, enabling multiple generations of datasets on the same wallet. Useful for separating test data from production data or managing dataset migrations per network.

**Example**:

```bash
CALIBRATION_DEALBOT_DATASET_VERSION=dealbot-v2
```

---

## Per-Network Scheduling

Scheduling rates and intervals are configured per network, so each network can be tuned independently (e.g. an aggressive calibration cadence with a conservative mainnet cadence). Every variable below must be prefixed with the uppercase network name.

Dealbot uses pg-boss for rate-based scheduling — see [Jobs (pg-boss)](#jobs-pg-boss) for global worker/timeout settings.

### `<NET>_DEALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `4`
- **Limits**: capped at `20` to avoid excessive on-chain activity.

**Role**: Target deal creation rate per storage provider on this network.

**Notes**: Fractional values are supported (e.g. `0.25` ⇒ one deal every 4 hours per SP).

---

### `<NET>_DEAL_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `360` (6 minutes)
- **Minimum**: `120` (2 minutes)

**Role**: Maximum runtime for data-storage jobs on this network before forced abort via `AbortController`. Covers end-to-end execution including provider lookup, upload, and IPNI verification.

**When to update**:

- Increase if deal uploads on this network consistently take longer than the default
- Decrease to fail-fast on stuck jobs

---

### `<NET>_RETRIEVALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `2`
- **Limits**: capped at `20`.

**Role**: Target retrieval test rate per storage provider on this network.

---

### `<NET>_RETRIEVAL_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `60` (1 minute)
- **Minimum**: `60`

**Role**: Maximum runtime for retrieval jobs on this network before forced abort via `AbortController`.

**When to update**:

- Increase if retrieval tests on this network consistently exceed the default
- Decrease to detect and fail stuck retrievals faster

---

### `<NET>_DATASET_CREATIONS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `1`
- **Limits**: capped at `20`.

**Role**: Target dataset-creation rate per storage provider on this network.

---

### `<NET>_DATA_SET_CREATION_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `300` (5 minutes)
- **Minimum**: `60`

**Role**: Maximum runtime for dataset-creation jobs on this network before forced abort via `AbortController`.

**When to update**:

- Increase if dataset creation on this network consistently takes longer (e.g. slow networks or large initial piece uploads)
- Decrease to fail faster on stuck provider interactions

---

### `<NET>_PROVIDERS_REFRESH_INTERVAL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `14400` (4 hours)

**Role**: How often the providers-refresh job runs for this network.

---

### `<NET>_DATA_RETENTION_POLL_INTERVAL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `3600` (1 hour)

**Role**: How often the data-retention polling job runs for this network. The job checks and updates data-retention stats of providers for stored datasets.

---

### `<NET>_MAINTENANCE_WINDOWS_UTC`

- **Type**: `string` (comma-separated `HH:MM` times in UTC)
- **Required**: No
- **Default**: `07:00,22:00`

**Role**: Daily maintenance windows (UTC) during which deal-creation and retrieval checks are skipped for this network. Different networks can have different schedules.

**Example**:

```bash
CALIBRATION_MAINTENANCE_WINDOWS_UTC=06:30,21:30
MAINNET_MAINTENANCE_WINDOWS_UTC=05:00,17:00
```

---

### `<NET>_MAINTENANCE_WINDOW_MINUTES`

- **Type**: `number`
- **Required**: No
- **Default**: `20`
- **Minimum**: `20`
- **Maximum**: `360` (6 hours)

**Role**: Duration (minutes) of each maintenance window in `<NET>_MAINTENANCE_WINDOWS_UTC`.

---

### `<NET>_BLOCKED_SP_IDS`

- **Type**: `string` (comma-separated provider IDs)
- **Required**: No
- **Default**: `""` (empty — no providers blocked)

**Role**: Global blocklist by provider numeric ID. Providers listed here are excluded from **all** scheduled
check types (data-storage, retrieval, and data-retention).

**Example**: `<NET>_BLOCKED_SP_IDS=1234,5678`

---

### `<NET>_BLOCKED_SP_ADDRESSES`

- **Type**: `string` (comma-separated provider Ethereum addresses)
- **Required**: No
- **Default**: `""` (empty — no providers blocked)

**Role**: Global blocklist by provider address. Providers listed here are excluded from **all** scheduled
check types (data-storage, retrieval, and data-retention). Matching is case-insensitive.

**Example**: `<NET>_BLOCKED_SP_ADDRESSES=0xAbCd...,0x1234...`

---

### `<NET>_MAX_DATASET_STORAGE_SIZE_BYTES`

- **Type**: `number` (integer, bytes)
- **Required**: No
- **Default**: `25769803776` (24 GiB)
- **Minimum**: `1`

**Role**: **High-water mark.** Maximum total stored data per SP (in bytes) before cleanup kicks in. When live storage for a provider exceeds this value, the cleanup job triggers and deletes the oldest pieces until usage drops below `<NET>_TARGET_DATASET_STORAGE_SIZE_BYTES` (the low-water mark).

**When to update**:

- Increase for longer runway before cleanup kicks in (e.g. months vs weeks)
- Decrease if SP storage is constrained or costs are a concern

**Example**:

```bash
<NET>_MAX_DATASET_STORAGE_SIZE_BYTES=12884901888  # 12 GiB per SP
```

---

### `<NET>_TARGET_DATASET_STORAGE_SIZE_BYTES`

- **Type**: `number` (integer, bytes)
- **Required**: No
- **Default**: `21474836480` (20 GiB)
- **Minimum**: `1`

**Role**: **Low-water mark.** When cleanup triggers (live usage exceeds `<NET>_MAX_DATASET_STORAGE_SIZE_BYTES`), pieces are deleted until usage drops below this target. The gap between MAX and TARGET creates headroom so cleanup doesn't re-trigger immediately.

**Headroom math**: At 4 deals/SP/hour × 10 MiB = ~960 MiB/day growth. With 4 GiB headroom (24 GiB MAX − 20 GiB TARGET), cleanup provides ~4 days of breathing room per run, which aligns with the daily default cadence.

**When to update**:

- Decrease for more aggressive cleanup (larger gap = more headroom)
- Increase toward MAX for minimal cleanup (smaller gap = less headroom)
- Must be less than `<NET>_MAX_DATASET_STORAGE_SIZE_BYTES` for cleanup to have effect

**Example**:

```bash
<NET>_TARGET_DATASET_STORAGE_SIZE_BYTES=16106127360  # 15 GiB per SP (9 GiB headroom)
```

---

### `<NET>_PIECE_CLEANUP_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `0.0417` (~1/24, approximately once per day)
- **Minimum**: `0.001`
- **Maximum**: `20`

**Role**: Target number of piece cleanup runs per storage provider per hour. Controls how frequently the cleanup job runs for each SP. The rate is converted to an interval internally (e.g. 1/hr = every 3600s, 1/24/hr ≈ every 86400s = once per day).

**When to update**:

- Increase to run cleanup more frequently when SPs are frequently over quota
- Decrease to reduce scheduling overhead

**Example**:

```bash
# Once per hour (more aggressive)
<NET>_PIECE_CLEANUP_PER_SP_PER_HOUR=1

# Once per week (very conservative)
<NET>_PIECE_CLEANUP_PER_SP_PER_HOUR=0.006
```

---

### `<NET>_MAX_PIECE_CLEANUP_RUNTIME_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `300` (5 minutes)
- **Minimum**: `60`

**Role**: Maximum runtime for a cleanup job before forced abort via `AbortController`. Prevents stuck cleanup jobs from blocking the SP work queue.

**When to update**:

- Increase if piece deletion calls to the Synapse SDK are known to be slow
- Decrease for faster abort detection on stuck jobs

---

### `<NET>_PULL_CHECKS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `1`
- **Limits**: capped at `20`.

**Role**: Target number of pull-check runs per storage provider per hour on this network. Pull checks validate the SP pull-to-park pathway by serving a temporary piece URL from Dealbot and asking the SP to pull and park it. Independent of deal and retrieval rates.

**Notes**: Fractional values are supported (e.g. `0.5` ⇒ one pull check every 2 hours per SP).

---

### `<NET>_PULL_CHECK_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `300` (5 minutes)

**Role**: Maximum runtime for pull-check jobs on this network before forced abort via `AbortController`. Bounds the total polling window for a terminal SP pull status.

---

### `<NET>_PULL_CHECK_POLL_INTERVAL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `2`

**Role**: Polling interval (seconds) used while waiting for a terminal SP pull status during a pull-check job on this network.

**When to update**:

- Increase to reduce polling load against SP endpoints
- Decrease for faster detection of completed or failed pulls

---

### `<NET>_PULL_PIECE_CLEANUP_INTERVAL_SECONDS`

- **Type**: `number` (seconds)
- **Required**: No
- **Default**: `604800` (7 days)
- **Minimum**: `3600` (1 hour)

**Role**: How often the `pull_piece_cleanup` job runs for this network to delete expired `pull_pieces` rows (those whose `expires_at` is in the past).

**When to update**:

- Decrease if pull-piece rows are accumulating faster than expected at this network's pull-check rate
- Increase to reduce background cleanup overhead

---

## Jobs (pg-boss)

These variables are **global** (not per-network) and control the shared pg-boss worker runtime. Scheduling is rate-based (per hour, per network) and persisted in Postgres so restarts do not reset timing — see [Per-Network Scheduling](#per-network-scheduling) for the rate/interval knobs.


### `DEALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `4`

**Role**: Target deal creation rate per storage provider.

**Limits**: Config schema caps this at 20 to avoid excessive on-chain activity.

**Notes**: Fractional values are supported. For example, `0.25` means one deal every 4 hours per storage provider.

---

### `RETRIEVALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No  
- **Default**: `2`

**Role**: Target retrieval test rate per storage provider.

**Limits**: Config schema caps this at 20 to avoid overloading providers.

**Notes**: Fractional values are supported. For example, `0.25` means one retrieval every 4 hours per storage provider.

---

### `MIN_NUM_DATASETS_FOR_CHECKS`

- **Type**: `number` (integer)
- **Required**: No
- **Default**: `1`
- **Minimum**: `1`
- **Enforced**: Yes (config validation)

**Role**: Minimum number of live on-chain datasets (slots) each active storage provider must maintain for checks to function. The `data_set_creation` job reconciles providers to this count on every run. Increasing this value gives the `data_retention` check more datasets to sample proofs from, which affects FWSS approval evaluation.

**When to update**:

- Increase if you want more datasets per provider to raise the density of data-retention proof samples.
- Decrease to reduce on-chain footprint per provider during testing.

**See also**: [`docs/data-set-creation.md`](./data-set-creation.md)

---

### `DATASET_CREATIONS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `1`

**Role**: Target dataset creation rate per storage provider.

**Limits**: Config schema caps this at 20 to avoid excessive dataset generation.

**Notes**: Fractional values are supported. For example, `0.5` means one dataset creation every 2 hours per storage provider.

---

### `DATASET_LIFECYCLE_CHECK_ENABLED`

- **Type**: `boolean`
- **Required**: No
- **Default**: `false` on mainnet, `true` everywhere else

**Role**: Enables the `data_set_lifecycle_check` canary job. Each tick both creation variants run in parallel: the **empty variant** (`createDataSet → terminateService`) and the **with-pieces variant** (`uploadPieceStreaming → findPiece → createDataSetAndAddPieces → terminateService`). Both paths immediately terminate their throwaway data set. If either variant fails the job fails — dependency outages are not swallowed as success.

**Notes**: Self-contained — it does not touch the managed check data sets and does not depend on `data_set_creation`. When disabled, stale schedules are removed so they stop enqueuing no-op jobs.

**See also**: [`docs/checks/data-set-lifecycle-check.md`](./checks/data-set-lifecycle-check.md)

---

### `DATASET_LIFECYCLE_CHECKS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `1`

**Role**: Target lifecycle check rate per storage provider for the `data_set_lifecycle_check` canary. Each tick runs both variants (empty and with-pieces) in parallel and terminates each throwaway data set.

**Limits**: Config schema caps this at 20.

**Notes**: Independent of `DATASET_CREATIONS_PER_SP_PER_HOUR`. Fractional values are supported.

---

### `JOB_SCHEDULER_POLL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `300`

**Role**: How often the scheduler polls Postgres for due jobs.

**Notes**: Minimum is 60 seconds to avoid excessive polling; default is 300 seconds.

---

### `JOB_WORKER_POLL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `60`

**Role**: How often pg-boss workers check for new jobs.

**Notes**: Minimum is 5 seconds. Lower values reduce job pickup latency but increase DB chatter.

---

### `PG_BOSS_LOCAL_CONCURRENCY`

- **Type**: `number`
- **Required**: No
- **Default**: `20`
- **Minimum**: `1`

**Role**: Per-instance pg-boss worker concurrency for the `sp.work` queue (`localConcurrency`). This is the total concurrency budget shared by deal and retrieval jobs.

**When to update**:

- Increase for faster throughput (more concurrent jobs; higher load)
- Decrease to reduce load or for more conservative testing

**Example**:

```bash
PG_BOSS_LOCAL_CONCURRENCY=20
```

**Sizing note**: A rough estimate for required concurrency is
`(providers * jobs_per_hour_per_provider * avg_duration_seconds) / 3600`.
Use p95 duration for a more conservative default.

---

### `DEALBOT_PGBOSS_SCHEDULER_ENABLED`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: Enables/disables the pg-boss scheduler loop that enqueues due jobs. Set to `false` for worker-only pods that should only process existing jobs.

**Example**:

```bash
DEALBOT_PGBOSS_SCHEDULER_ENABLED=false
```

---

### `DEALBOT_PGBOSS_POOL_MAX`

- **Type**: `number`
- **Required**: No
- **Default**: `1`

**Role**: Maximum number of pg-boss connections per instance. Lower this when running through a
session-mode pooler (e.g. Supabase) to avoid exceeding pooler `pool_size`.

**Example**:

```bash
DEALBOT_PGBOSS_POOL_MAX=2
```

---

### `JOB_CATCHUP_MAX_ENQUEUE`

- **Type**: `number`
- **Required**: No
- **Default**: `10`

**Role**: Maximum number of jobs to enqueue per schedule row per poll. Any remaining backlog
is handled by future polls.

---

### `JOB_SCHEDULE_PHASE_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `0`

**Role**: Per-instance schedule phase offset (seconds) applied when initializing schedules.
Use this to stagger multiple dealbot deployments that are not sharing a database.

---

### `JOB_ENQUEUE_JITTER_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `0`

**Role**: Random delay (seconds) applied when enqueuing jobs to avoid synchronized bursts.

---

### `DATA_SET_CREATION_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `300` (5 minutes)
- **Minimum**: `60` (1 minute)
- **Enforced**: Yes (config validation, effective floor applied at runtime)

**Role**: Maximum runtime for `data_set_creation` jobs before forced abort via `AbortController`. Covers the full slot scan, any termination-repair polling, and dataset provisioning.

**When to update**:

- Increase if termination-repair polling (`pdpEndEpoch` confirmation) consistently times out on slow networks.
- Decrease for faster fail-fast behavior during testing.

**Note**: If the configured value is below 120 seconds, the runtime silently raises it to 120 seconds as an effective floor.

---

### `DATA_SET_LIFECYCLE_CHECK_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `600` (10 minutes)
- **Minimum**: `60` (1 minute)
- **Enforced**: Yes (config validation, effective floor applied at runtime)

**Role**: Maximum runtime for `data_set_lifecycle_check` jobs before forced abort via `AbortController`. Both variants run in parallel within this budget — the timeout bounds the wall-clock time from job start until both variants have settled (or been aborted).

**When to update**:

- Increase if the with-pieces variant (`uploadPieceStreaming` + `findPiece` + `createDataSetAndAddPieces` + `terminateServiceSync`) consistently times out on slow networks, since it has more steps than the empty variant and will typically be the critical path.
- Decrease for faster fail-fast behavior during testing.

**Note**: If the configured value is below 60 seconds, the runtime silently raises it to 60 seconds as an effective floor. An abort due to this timeout (or an internal poll timeout) is recorded as `dataSetLifecycleCheckStatus{value="failure.timedout"}` and retried on the next scheduled tick.

**See also**: [`docs/checks/data-set-lifecycle-check.md`](./checks/data-set-lifecycle-check.md)

---

### `DEAL_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `360` (6 minutes)
- **Minimum**: `120` (2 minutes)
- **Enforced**: Yes (config validation)

**Role**: Maximum runtime for data storage jobs before forced abort. When a deal job exceeds this timeout, it is actively cancelled using `AbortController`.

**When to update**:

- Increase if deal uploads consistently take longer than the default (e.g., slower networks, IPNI delays)
- Decrease if you want to fail-fast on stuck jobs

**Note**: This is independent of HTTP-level timeouts. The job timeout enforces end-to-end execution time of a Data Storage Check job including all operations (provider lookup, upload, IPNI verification, etc.).

---

### `RETRIEVAL_JOB_TIMEOUT_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `60` (1 minute)
- **Minimum**: `60`
- **Enforced**: Yes (config validation)

**Role**: Maximum runtime for retrieval test jobs before forced abort. When a retrieval job exceeds this timeout, it is actively cancelled using `AbortController`.

**When to update**:

- Increase if retrieval tests consistently take longer than the default
- Decrease to detect and fail stuck retrievals faster

**Note**: This is independent of HTTP-level timeouts. The job timeout enforces end-to-end execution time of a Retrieval Check job.

---

### `SHUTDOWN_FINAL_SCRAPE_DELAY_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `35`

**Role**: Seconds the process stays alive after pg-boss drains and workers finish, so that Prometheus can scrape the final counter increments emitted during shutdown. Without this delay, terminal metrics (job completion/failure counters) may be missed by the scraper.

**When to update**:

- Increase if your Prometheus scrape interval is longer than 35 seconds
- Decrease to speed up container shutdown when fast restarts are more important than final-scrape completeness

---

### `IPFS_BLOCK_FETCH_CONCURRENCY`

- **Type**: `number`
- **Required**: No
- **Default**: `6`
- **Minimum**: `1`
- **Enforced**: Yes (config validation)

**Role**: Maximum number of parallel block fetches when validating IPFS retrievals via DAG traversal.

**When to update**:

- Increase to speed up validation on fast networks and responsive gateways
- Decrease to reduce pressure on slower storage providers or constrained environments

**Note**: This affects the number of concurrent `/ipfs/<cid>` requests per retrieval.

---

## Pull Check Configuration

These variables tune global aspects of the pull-check subsystem — piece size and server-side streaming limits. Scheduling rates and timeouts are configured per network in the [Per-Network Scheduling](#per-network-scheduling) section.

### `PULL_CHECK_PIECE_SIZE_BYTES`

- **Type**: `number` (bytes)
- **Required**: No
- **Default**: `10485760` (10 MiB)

**Role**: Size (bytes) of the synthetic test piece Dealbot generates per pull-check run.

**When to update**:

- Increase for more realistic large-piece pull tests
- Decrease for faster jobs in low-bandwidth environments

---

### `PULL_PIECE_MAX_CONCURRENT_STREAMS`

- **Type**: `number`
- **Required**: No
- **Default**: `5`

**Role**: Maximum number of concurrent piece-streaming connections across all piece CIDs. Prevents a spike in pull requests from overloading the Dealbot HTTP server.

---

### `PULL_PIECE_MAX_STREAMS_PER_CID`

- **Type**: `number`
- **Required**: No
- **Default**: `3`

**Role**: Maximum number of concurrent streaming connections allowed per piece CID. Prevents a single CID from monopolizing the global stream budget.

---

## ClickHouse Configuration

ClickHouse is an **optional** long-term analytics store for check results. When `CLICKHOUSE_URL` is unset, ClickHouse emission is silently disabled and Dealbot runs normally using only Postgres and Prometheus.

### `CLICKHOUSE_URL`

- **Type**: `string` (HTTP URL)
- **Required**: No
- **Default**: Empty (ClickHouse disabled)
- **Security**: Treat as a secret if the URL contains credentials.

**Role**: ClickHouse connection URL. Must include the database in the path. When set, Dealbot buffers check results and flushes them to ClickHouse in batches. Write failures are logged and dropped — ClickHouse is not a source of truth.

**Example**:

```bash
CLICKHOUSE_URL=http://default:password@clickhouse.internal:8123/dealbot
```

---

### `CLICKHOUSE_BATCH_SIZE`

- **Type**: `number`
- **Required**: No
- **Default**: `500`

**Role**: Number of rows to accumulate before flushing to ClickHouse. Larger batches reduce HTTP overhead; smaller batches reduce memory usage and flush lag.

---

### `CLICKHOUSE_FLUSH_INTERVAL_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `5000` (5 seconds)

**Role**: Maximum time between ClickHouse flushes. Even if `CLICKHOUSE_BATCH_SIZE` is not reached, a flush is triggered after this interval to bound write latency.

---

### `CLICKHOUSE_MAX_BUFFER_SIZE`

- **Type**: `number`
- **Required**: No
- **Default**: `5000`

**Role**: Maximum number of rows to hold in the in-memory buffer before back-pressure is applied. When the buffer exceeds this limit, new rows are dropped and a warning is logged to prevent unbounded memory growth.

---

## Dataset Configuration

### `DEALBOT_LOCAL_DATASETS_PATH`

- **Type**: `string` (file path)
- **Required**: No
- **Default**: `./datasets`

**Role**: Directory path where randomly generated dataset files are stored.

**When to update**:

- When using a different storage location

---

### `RANDOM_PIECE_SIZES`

- **Type**: `string` (comma-separated numbers in bytes)
- **Required**: No
- **Default**: `10485760` (10 MiB)

**Role**: Sizes of randomly generated content used for data-storage checks, in bytes (original content size before CAR conversion).

**Note**: For IPNI-enabled deals, original content size is stored in deal metadata (`metadata.ipfs_pin.originalSize`) while `deals.file_size` stores the CAR size (bytes uploaded).

**When to update**:

- Add smaller sizes for quick tests
- Add larger sizes for stress testing
- Adjust based on storage provider capabilities

**Example scenario**: Testing with smaller files only:

```bash
RANDOM_PIECE_SIZES=1024,10240,102400
```

---

## Timeout Configuration

### `CONNECT_TIMEOUT_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `10000` (10 seconds)
- **Minimum**: `1000`

**Role**: Maximum time to wait for establishing a connection and receiving initial response headers.

**When to update**:

- Increase for slow networks or distant servers
- Decrease for faster failure detection

---

### `HTTP_REQUEST_TIMEOUT_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `240000` (4 minutes)
- **Minimum**: `1000`

**Role**: Maximum total time for HTTP/1.1 requests, including body transfer.

**When to update**:

- Increase for large file retrievals
- Decrease to fail faster on slow providers

---

### `HTTP2_REQUEST_TIMEOUT_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `240000` (4 minutes)
- **Minimum**: `1000`

**Role**: Maximum total time for HTTP/2 requests, including body transfer.

**When to update**:

- Typically kept in sync with `HTTP_REQUEST_TIMEOUT_MS`

---

### `IPNI_VERIFICATION_TIMEOUT_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `60000` (60 seconds)
- **Minimum**: `1000`

**Role**: Maximum time to wait for IPNI verification to confirm the provider for a root CID. Used by both data-storage and retrieval checks.

**When to update**:

- Increase if IPNI propagation is slow
- Decrease to fail faster on unresponsive indexers

---

### `IPNI_VERIFICATION_POLLING_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `2000` (2 seconds)
- **Minimum**: `250`

**Role**: Polling interval for IPNI verification. Used by both data-storage and retrieval checks.

**When to update**:

- Increase to reduce IPNI query load
- Decrease to detect results faster

---

## Prometheus Metrics Configuration

### `PROMETHEUS_WALLET_BALANCE_TTL_SECONDS`

- **Type**: `number` (seconds)
- **Required**: No
- **Default**: `3600` (1 hour)

**Role**: Cache time-to-live for wallet balance collection. Wallet balances are cached and only refreshed when this TTL expires, even when Prometheus scrapes the `/metrics` endpoint.

**When to update**:

- Increase to reduce blockchain RPC calls (slower balance updates, lower load)
- Decrease for more frequent balance updates (higher RPC load, faster visibility)

**Example scenario**: Increasing cache TTL to 2 hours:

```bash
PROMETHEUS_WALLET_BALANCE_TTL_SECONDS=7200
```

---

### `PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS`

- **Type**: `number` (seconds)
- **Required**: No
- **Default**: `60` (1 minute)

**Role**: Cooldown period after a failed wallet balance fetch before retrying. After an error, the cache is considered expired but a new fetch will only be attempted after this cooldown.

**When to update**:

- Increase to reduce retry pressure on failing RPC endpoints
- Decrease to recover from transient errors faster

**Example scenario**: Increasing cooldown to 5 minutes:

```bash
PROMETHEUS_WALLET_BALANCE_ERROR_COOLDOWN_SECONDS=300
```

---

## Web Frontend

### `VITE_API_BASE_URL`

- **Type**: `string` (URL)
- **Required**: No
- **Default**: `http://localhost:8080`
- **Location**: `apps/web/.env` (dev) and container runtime (production)

**Role**: Base URL for the backend API, used by the Vite development server to proxy API requests.
In production containers, this is read from `runtime-config.js`, which is generated at container
startup from environment variables.

**Runtime wiring (Docker/K8s)**:

- Container entrypoint writes `/srv/runtime-config.js` from `DEALBOT_API_BASE_URL`
- Fallback: `VITE_API_BASE_URL` if `DEALBOT_API_BASE_URL` is not set

**When to update**:

- When `DEALBOT_PORT` is changed in the backend
- When the backend is running on a different host

**Example scenario**: Backend running on a different port:

```bash
VITE_API_BASE_URL=http://localhost:9000
```

---

### `VITE_PLAUSIBLE_DATA_DOMAIN`

- **Type**: `string` (domain)
- **Required**: No
- **Default**: Empty (Plausible disabled)
- **Location**: `apps/web/.env` (dev) and container runtime (production)

**Role**: Enables Plausible analytics for the web frontend when set. The value should match the Plausible site domain
you want to attribute events to (e.g., `dealbot.filoz.org` or `staging.dealbot.filoz.org`).

**Runtime wiring (Docker/K8s)**:

- Container entrypoint writes `/srv/runtime-config.js` from `VITE_PLAUSIBLE_DATA_DOMAIN`

**When to update**:

- Set to the production domain for production deployments
- Set to the staging domain for staging deployments
- Leave empty to disable analytics (local development or privacy-sensitive environments)

**Example**:

```bash
VITE_PLAUSIBLE_DATA_DOMAIN=dealbot.filoz.org
```

**Docker run example**:

```bash
docker run \
  -e DEALBOT_API_BASE_URL=http://dealbot-api:3130 \
  -e VITE_PLAUSIBLE_DATA_DOMAIN=dealbot.filoz.org \
  -p 8080:80 \
  dealbot-web:latest
```

---

### `DEALBOT_API_BASE_URL`

- **Type**: `string` (URL)
- **Required**: No
- **Default**: Empty (uses relative URLs)
- **Location**: Container runtime env (production)

**Role**: Runtime override for the web frontend API base URL. Used to populate
`/srv/runtime-config.js` on container startup.

**When to update**:

- Set in production to point the frontend at your backend service
- Leave empty to use relative `/api` paths

---


## Environment Files Reference

| File                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `.env.example` (root)       | Kubernetes secrets template (wallet credentials only) |
| `apps/backend/.env.example` | Full backend configuration template                   |
| `apps/web/.env.example`     | Frontend configuration template                       |

For local Kubernetes development, see [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions.