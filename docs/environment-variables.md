# Environment Variables Reference

This document provides a comprehensive guide to all environment variables used by the Dealbot. Understanding these variables is essential for proper configuration in development, testing, and production environments.

## Quick Reference

| Category                                  | Variables                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Application](#application-configuration) | `NODE_ENV`, `DEALBOT_PORT`, `DEALBOT_HOST`, `DEALBOT_RUN_MODE`, `DEALBOT_METRICS_PORT`, `DEALBOT_METRICS_HOST`, `DEALBOT_ALLOWED_ORIGINS`, `ENABLE_DEV_MODE` |
| [Database](#database-configuration)       | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_POOL_MAX`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`                                                 |
| [Blockchain](#blockchain-configuration)   | `NETWORK`, `WALLET_ADDRESS`, `WALLET_PRIVATE_KEY`, `CHECK_DATASET_CREATION_FEES`, `USE_ONLY_APPROVED_PROVIDERS`, `ENABLE_IPNI_TESTING` |
| [Dataset Versioning](#dataset-versioning) | `DEALBOT_DATASET_VERSION`                                                                                                                                    |
| [Scheduling](#scheduling-configuration)   | `DEAL_INTERVAL_SECONDS`, `DEAL_MAX_CONCURRENCY`, `RETRIEVAL_MAX_CONCURRENCY`, `RETRIEVAL_INTERVAL_SECONDS`, `DEAL_START_OFFSET_SECONDS`, `RETRIEVAL_START_OFFSET_SECONDS`, `METRICS_START_OFFSET_SECONDS`, `DEALBOT_MAINTENANCE_WINDOWS_UTC`, `DEALBOT_MAINTENANCE_WINDOW_MINUTES`         |
| [Jobs (pg-boss)](#jobs-pg-boss)           | `DEALBOT_JOBS_MODE`, `DEALBOT_PGBOSS_SCHEDULER_ENABLED`, `DEALBOT_PGBOSS_POOL_MAX`, `DEALS_PER_SP_PER_HOUR`, `RETRIEVALS_PER_SP_PER_HOUR`, `METRICS_PER_HOUR`, `JOB_SCHEDULER_POLL_SECONDS`, `JOB_WORKER_POLL_SECONDS`, `JOB_CATCHUP_MAX_ENQUEUE`, `JOB_CATCHUP_SPREAD_HOURS`, `JOB_LOCK_RETRY_SECONDS`, `JOB_SCHEDULE_PHASE_SECONDS`, `JOB_ENQUEUE_JITTER_SECONDS`, `DEAL_JOB_TIMEOUT_SECONDS`, `RETRIEVAL_JOB_TIMEOUT_SECONDS` |
| [Dataset](#dataset-configuration)         | `DEALBOT_LOCAL_DATASETS_PATH`, `RANDOM_DATASET_SIZES`                                                                                                        |
| [Proxy](#proxy-configuration)             | `PROXY_LIST`, `PROXY_LOCATIONS`                                                                                                                              |
| [Timeouts](#timeout-configuration)        | `CONNECT_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `HTTP2_REQUEST_TIMEOUT_MS`, `RETRIEVAL_TIMEOUT_BUFFER_MS`                                                   |
| [Web Frontend](#web-frontend)             | `VITE_API_BASE_URL`, `VITE_PLAUSIBLE_DATA_DOMAIN`, `DEALBOT_API_BASE_URL`                                                                                    |

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

## Blockchain Configuration

### `NETWORK`

- **Type**: `string`
- **Required**: No
- **Default**: `calibration`
- **Valid values**: `mainnet`, `calibration`

**Role**: Determines which Filecoin network to interact with. This affects contract addresses, RPC endpoints, and token economics.

**When to update**:

- Set to `calibration` for testing with test FIL/USDFC tokens
- Set to `mainnet` for production deployments with real FIL/USDFC

**⚠️ Warning**: Switching to `mainnet` will use real FIL/USDFC tokens. Ensure your wallet is funded and you understand the costs involved.

---

### `WALLET_ADDRESS`

- **Type**: `string` (Ethereum-style address)
- **Required**: Yes
- **Security**: Public, but should match `WALLET_PRIVATE_KEY`

**Role**: The Ethereum/FEVM address used for signing transactions and paying for storage deals.

**When to update**:

- When switching to a different wallet
- When setting up a new Dealbot instance
- When rotating keys for security

**Example**:

```bash
WALLET_ADDRESS=0x1234567890abcdef1234567890abcdef12345678
```

---

### `WALLET_PRIVATE_KEY`

- **Type**: `string`
- **Required**: Yes
- **Security**: **HIGHLY SENSITIVE** - Never commit to version control, use secrets management

**Role**: Private key for the wallet, used to sign blockchain transactions for creating storage deals.

**When to update**:

- When rotating keys for security
- When setting up a new Dealbot instance
- When switching wallets

**Security best practices**:

- Use Kubernetes Secrets or a secrets manager (Vault, AWS Secrets Manager)
- Never log or expose this value

---

### `CHECK_DATASET_CREATION_FEES`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: When enabled, validates that the wallet has sufficient balance to cover dataset creation fees + 100 GiB of storage costs.

**When to update**:

- Set to `false` to skip addition of dataset creation fees into storage costs.

---

### `USE_ONLY_APPROVED_PROVIDERS`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: Restricts deal-making to only Filecoin Warm Storage Service (FWSS) approved storage providers. This ensures deals are made with approved providers.

**When to update**:

- Set to `false` to test with any storage provider available for testing (providers that support "PDP" product in ServiceProviderRegistry)

---

### `ENABLE_IPNI_TESTING`

- **Type**: `string` (enum)
- **Required**: No
- **Default**: `always`
- **Valid values**: `disabled`, `random`, `always`

**Role**: Controls if IPNI is enabled for deals. Adds a key (`withIPFSIndexing`) to dataset metadata when IPNI is enabled.

**When to update**:

- Set to `disabled` to skip deal-making with IPNI support.
- Set to `random` to enable IPNI for ~50% of deals.
- Set to `always` to enable IPNI for every deal.

**Note**: Legacy values `true` and `false` are accepted and map to `always` and `disabled` respectively.

---

## Dataset Versioning

### `DEALBOT_DATASET_VERSION`

- **Type**: `string`
- **Required**: No
- **Default**: Not set (no versioning)

**Role**: Creates versioning for datasets, allowing multiple dataset versions without changing wallet addresses. Useful for separating test data from production data or managing dataset migrations.

**When to update**:

- When you want to create a fresh set of datasets
- When separating environments (e.g., `dealbot-v1`, `dealbot-staging`)

**Example scenario**: Creating a new dataset version for testing:

```bash
DEALBOT_DATASET_VERSION=dealbot-v2
```

---

## Scheduling Configuration

These variables control when and how often the Dealbot runs its automated jobs.

**Note**: When `DEALBOT_JOBS_MODE=pgboss`, the offsets below are not used; pg-boss uses
rate-based scheduling instead (see [Jobs (pg-boss)](#jobs-pg-boss)).

### `DEAL_INTERVAL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `30` (config) / `1800` (30 minutes, recommended)

**Role**: How often the deal creation job runs, in seconds.

**When to update**:

- Increase for less frequent deal creation (reduces costs, slower testing)
- Decrease for more aggressive testing (higher costs, faster feedback)

**Example scenario**: Running deals every hour instead of every 30 minutes:

```bash
DEAL_INTERVAL_SECONDS=3600
```

---

### `DEAL_MAX_CONCURRENCY`

- **Type**: `number`
- **Required**: No
- **Default**: `10`
- **Minimum**: `1`

**Role**: Controls deal-job concurrency. When `DEALBOT_JOBS_MODE=cron`, this is the maximum number of providers processed in parallel per batch; batches run sequentially. When `DEALBOT_JOBS_MODE=pgboss`, this sets the pg-boss `teamSize` for `deal.run` workers.

**When to update**:

- Increase for faster deal creation (more concurrent uploads; higher load)
- Decrease to reduce load or for more conservative testing

**Example**:

```bash
DEAL_MAX_CONCURRENCY=10
```

**Sizing note**: A rough estimate for required concurrency is
`(providers * jobs_per_hour_per_provider * avg_duration_seconds) / 3600`.
Use p95 duration for a more conservative default.

---

### `RETRIEVAL_MAX_CONCURRENCY`

- **Type**: `number`
- **Required**: No
- **Default**: `10`
- **Minimum**: `1`

**Role**: Maximum number of retrieval tests executed in parallel when running pg-boss workers.

**When to update**:

- Increase to clear retrieval backlogs faster (higher provider load)
- Decrease to limit simultaneous retrievals

**Example**:

```bash
RETRIEVAL_MAX_CONCURRENCY=10
```

**Sizing note**: A rough estimate for required concurrency is
`(providers * jobs_per_hour_per_provider * avg_duration_seconds) / 3600`.
Use p95 duration for a more conservative default.

---

### `RETRIEVAL_INTERVAL_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `60` (config) / `3600` (1 hour, recommended)

**Role**: How often retrieval tests run, in seconds.

**When to update**:

- Increase for less frequent retrieval testing
- Decrease for more frequent monitoring (may increase load on providers)

**Constraint**: Must be large enough to accommodate the timeout settings:

```
RETRIEVAL_INTERVAL_SECONDS * 1000 - RETRIEVAL_TIMEOUT_BUFFER_MS >= max(HTTP_REQUEST_TIMEOUT_MS, HTTP2_REQUEST_TIMEOUT_MS)
```

---

### `DEAL_START_OFFSET_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `0`

**Role**: Delay before the first deal creation job runs after startup.

**When to update**:

- Increase to allow other services to initialize first
- Keep at `0` for immediate deal creation on startup

---

### `RETRIEVAL_START_OFFSET_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `600` (10 minutes) / `300` (5 minutes in .env.example)

**Role**: Delay before the first retrieval test runs after startup. This offset prevents retrieval tests from running concurrently with deal creation.

**When to update**:

- Adjust to stagger job execution and prevent resource contention
- Increase if deal creation takes longer than expected

---

### `METRICS_START_OFFSET_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `900` (15 minutes) / `600` (10 minutes in .env.example)

**Role**: Delay before metrics collection jobs start after startup.

**When to update**:

- Adjust to ensure metrics collection doesn't overlap with other jobs

---

### `DEALBOT_MAINTENANCE_WINDOWS_UTC`

- **Type**: `string` (comma-separated HH:MM times in UTC)
- **Required**: No
- **Default**: `07:00,22:00`

**Role**: Daily maintenance windows (UTC) during which deal creation and retrieval checks are skipped.

**Notes**:

- Times must be in 24-hour `HH:MM` format.
- Applies to both cron and pg-boss modes.

**Example**:

```bash
DEALBOT_MAINTENANCE_WINDOWS_UTC=06:30,21:30
```

---

### `DEALBOT_MAINTENANCE_WINDOW_MINUTES`

- **Type**: `number`
- **Required**: No
- **Default**: `20`
- **Minimum**: `20`
- **Maximum**: `360` (6 hours). With two daily windows, this keeps maintenance time ≤ runtime.

**Role**: Duration (minutes) of each maintenance window in `DEALBOT_MAINTENANCE_WINDOWS_UTC`.

**Example**:

```bash
DEALBOT_MAINTENANCE_WINDOW_MINUTES=30
```

---

## Jobs (pg-boss)

These variables are only used when `DEALBOT_JOBS_MODE=pgboss`. In this mode, scheduling is
rate-based (per hour) and persisted in Postgres so restarts do not reset timing.

### `DEALBOT_JOBS_MODE`

- **Type**: `string`
- **Required**: No
- **Default**: `cron`
- **Valid values**: `cron`, `pgboss`

**Role**: Switches between the legacy in-process cron scheduler and pg-boss.

**Runbook**: See `docs/runbooks/jobs.md` for pg-boss operational guidance (pausing, resuming, maintenance).

---

### `DEALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: Derived from `DEAL_INTERVAL_SECONDS` (1 per interval per SP)

**Role**: Target deal creation rate per storage provider.

**Limits**: Config schema caps this at 20 to avoid excessive on-chain activity.

**Notes**: Fractional values are supported. For example, `0.25` means one deal every 4 hours per storage provider.

---

### `RETRIEVALS_PER_SP_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: Derived from `RETRIEVAL_INTERVAL_SECONDS` (1 per interval per SP)

**Role**: Target retrieval test rate per storage provider.

**Limits**: Config schema caps this at 20 to avoid overloading providers.

**Notes**: Fractional values are supported. For example, `0.25` means one retrieval every 4 hours per storage provider.

---

### `METRICS_PER_HOUR`

- **Type**: `number`
- **Required**: No
- **Default**: `2`

**Role**: How often metrics aggregation runs per hour.

**Limits**: Config schema caps this at 3 to limit database load.

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

### `JOB_CATCHUP_SPREAD_HOURS`

- **Type**: `number`
- **Required**: No
- **Default**: `3`

**Role**: When catching up, delayed jobs are spread evenly over this window.

---

### `JOB_LOCK_RETRY_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `60`

**Role**: Delay before re-queuing a job when the per-SP mutual-exclusion lock is held.

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

**Note**: This is independent of HTTP-level timeouts and the schedule-based `RETRIEVAL_TIMEOUT_BUFFER_MS`. The job timeout enforces end-to-end execution time of a Retrieval Check job.

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

### `RANDOM_DATASET_SIZES`

- **Type**: `string` (comma-separated numbers in bytes)
- **Required**: No
- **Default**: `10240,10485760,104857600` (10 KiB, 10 MB, 100 MB)

**Role**: Sizes of randomly generated datasets used for deal-making, in bytes.

**When to update**:

- Add smaller sizes for quick tests
- Add larger sizes for stress testing
- Adjust based on storage provider capabilities

**Example scenario**: Testing with smaller files only:

```bash
RANDOM_DATASET_SIZES=1024,10240,102400
```

---

## Proxy Configuration

### `PROXY_LIST`

- **Type**: `string` (comma-separated proxy URLs)
- **Required**: No
- **Default**: Empty

**Role**: List of HTTP proxy servers to use for retrieval tests. Useful for geo-distributed testing.

**When to update**:

- When testing retrieval from different geographic locations

**Format**: `http://username:password@host:port`

**Example**:

```bash
PROXY_LIST=http://user:pass@proxy1.example.com:8080,http://user:pass@proxy2.example.com:8080
```

---

### `PROXY_LOCATIONS`

- **Type**: `string` (comma-separated location identifiers)
- **Required**: No
- **Default**: Empty

**Role**: Labels for each proxy in `PROXY_LIST`. Not used for anything, just for reporting.

**When to update**:

- When adding or removing proxies
- Must have the same number of entries as `PROXY_LIST`

**Example**:

```bash
PROXY_LOCATIONS=us-east,eu-west
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

### `RETRIEVAL_TIMEOUT_BUFFER_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `60000` (1 minute)
- **Minimum**: `0`

**Role**: Safety buffer to stop retrieval batch processing before the next scheduled run. Prevents overlapping retrieval batches.

**When to update**:

- Increase if retrieval batches are overlapping
- Decrease if you want to maximize retrieval testing time

**Constraint**: Must be less than `RETRIEVAL_INTERVAL_SECONDS * 1000`

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
