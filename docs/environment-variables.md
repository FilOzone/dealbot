# Environment Variables Reference

This document provides a comprehensive guide to all environment variables used by the Dealbot. Understanding these variables is essential for proper configuration in development, testing, and production environments.

## Quick Reference

| Category                                  | Variables                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Application](#application-configuration) | `NODE_ENV`, `DEALBOT_PORT`, `DEALBOT_HOST`, `DEALBOT_ALLOWED_ORIGINS`                                                                                        |
| [Database](#database-configuration)       | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`                                                                      |
| [Blockchain](#blockchain-configuration)   | `NETWORK`, `WALLET_ADDRESS`, `WALLET_PRIVATE_KEY`, `CHECK_DATASET_CREATION_FEES`, `USE_ONLY_APPROVED_PROVIDERS`, `ENABLE_CDN_TESTING`, `ENABLE_IPNI_TESTING` |
| [Dataset Versioning](#dataset-versioning) | `DEALBOT_DATASET_VERSION`                                                                                                                                    |
| [Scheduling](#scheduling-configuration)   | `DEAL_INTERVAL_SECONDS`, `RETRIEVAL_INTERVAL_SECONDS`, `DEAL_START_OFFSET_SECONDS`, `RETRIEVAL_START_OFFSET_SECONDS`, `METRICS_START_OFFSET_SECONDS`         |
| [Dataset](#dataset-configuration)         | `DEALBOT_LOCAL_DATASETS_PATH`, `KAGGLE_DATASET_TOTAL_PAGES`, `RANDOM_DATASET_SIZES`                                                                          |
| [Proxy](#proxy-configuration)             | `PROXY_LIST`, `PROXY_LOCATIONS`                                                                                                                              |
| [Timeouts](#timeout-configuration)        | `CONNECT_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `HTTP2_REQUEST_TIMEOUT_MS`, `RETRIEVAL_TIMEOUT_BUFFER_MS`                                                   |
| [External Services](#external-services)   | `FILBEAM_BOT_TOKEN`                                                                                                                                          |
| [Web Frontend](#web-frontend)             | `VITE_API_BASE_URL`                                                                                                                                          |

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

### `ENABLE_CDN_TESTING`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: Enables adding deal-making with CDN support. Adds a key(`withCDN`) to dataset metadata, used to request that CDN services should be enabled.

**When to update**:

- Set to `false` to disable deal-making with CDN support.
- Keep as `true` for deal-making with CDN support.

---

### `ENABLE_IPNI_TESTING`

- **Type**: `boolean`
- **Required**: No
- **Default**: `true`

**Role**: Enables deal-making with IPFS support. Adds a key(`withIPFSIndexing`) to dataset metadata, used to request that IPFS indexing is performed.

**When to update**:

- Set to `false` to skip deal-making with IPFS support.
- Keep as `true` for deal-making with IPNI Indexing support.

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

**Role**: Delay before the first deal creation job runs when no deals exist yet (fresh DB).

**When to update**:

- Increase to allow other services to initialize first
- Keep at `0` for immediate deal creation on startup
- Ignored once deals exist; scheduling uses last deal `created_at + interval`

---

### `RETRIEVAL_START_OFFSET_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `600` (10 minutes) / `300` (5 minutes in .env.example)

**Role**: Delay before the first retrieval test runs when no retrievals exist yet (fresh DB). This offset helps stagger the initial run.

**When to update**:

- Adjust to stagger job execution and prevent resource contention
- Increase if deal creation takes longer than expected
- Ignored once retrievals exist; scheduling uses last retrieval `created_at + interval`

---

### `METRICS_START_OFFSET_SECONDS`

- **Type**: `number`
- **Required**: No
- **Default**: `900` (15 minutes) / `600` (10 minutes in .env.example)

**Role**: Delay before metrics collection jobs start when no metrics rows exist yet (fresh DB).

**When to update**:

- Adjust to ensure metrics collection doesn't overlap with other jobs
- Ignored once metrics rows exist; scheduling uses last `created_at` / `refreshed_at` + interval

---

## Dataset Configuration

### `DEALBOT_LOCAL_DATASETS_PATH`

- **Type**: `string` (file path)
- **Required**: No
- **Default**: `./datasets`

**Role**: Directory path where local dataset files are stored. If kaggle dataset download fails, the files in this directory are used as fallback to create deals.

**When to update**:

- When using a different storage location

---

### `KAGGLE_DATASET_TOTAL_PAGES`

- **Type**: `number`
- **Required**: No
- **Default**: `500`

**Role**: Number of pages to fetch when discovering Kaggle datasets for testing.

**When to update**:

- Increase for more dataset variety

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
- **Default**: `600000` (10 minutes)
- **Minimum**: `1000`

**Role**: Maximum total time for HTTP/1.1 requests, including body transfer.

**When to update**:

- Increase for large file retrievals
- Decrease to fail faster on slow providers

---

### `HTTP2_REQUEST_TIMEOUT_MS`

- **Type**: `number` (milliseconds)
- **Required**: No
- **Default**: `600000` (10 minutes)
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

## External Services

### `FILBEAM_BOT_TOKEN`

- **Type**: `string`
- **Required**: No
- **Default**: Empty
- **Security**: **SENSITIVE** - API token

**Role**: Authentication token for FilBeam bot integration. Enables FilBeam to distinguish bot traffic from real user traffic.

---

## Web Frontend

### `VITE_API_BASE_URL`

- **Type**: `string` (URL)
- **Required**: No
- **Default**: `http://localhost:8080`
- **Location**: `apps/web/.env`

**Role**: Base URL for the backend API, used by the Vite development server to proxy API requests.

**When to update**:

- When `DEALBOT_PORT` is changed in the backend
- When the backend is running on a different host

**Example scenario**: Backend running on a different port:

```bash
VITE_API_BASE_URL=http://localhost:9000
```

---

## Environment Files Reference

| File                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `.env.example` (root)       | Kubernetes secrets template (wallet credentials only) |
| `apps/backend/.env.example` | Full backend configuration template                   |
| `apps/web/.env.example`     | Frontend configuration template                       |

For local Kubernetes development, see [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions.
