# Deal Bot Backend

> NestJS-based API server for automated Filecoin deal creation and monitoring

This is the backend service for Deal Bot, built with NestJS and TypeScript. It handles automated deal creation, retrieval testing, metrics collection, and provides a REST API for the web dashboard.

## Tech Stack

- **Framework:** NestJS 11.x
- **Language:** TypeScript 5.x
- **Database:** PostgreSQL + TypeORM
- **Blockchain:** Filecoin (via Synapse SDK)
- **Scheduling:** NestJS Schedule (cron jobs)
- **API Docs:** Swagger/OpenAPI

## Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL database (running and accessible)
- Filecoin wallet with private key

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration (see [Configuration](#configuration) below).

### 3. Set Up Database

Ensure PostgreSQL is running and create a database:

```sql
CREATE DATABASE filecoin_dealbot;
CREATE USER dealbot WITH PASSWORD 'dealbot_password';
GRANT ALL PRIVILEGES ON DATABASE filecoin_dealbot TO dealbot;
```

The application will automatically run migrations on startup.

### 4. Run the Server

#### Development Mode (with hot-reload)

```bash
pnpm start:dev
```

Server runs at: `http://localhost:8080`
API Documentation: `http://localhost:8080/api`

#### Production Mode

```bash
# Build the application
pnpm build

# Run the built application
pnpm start:prod
```

## Configuration

All configuration is done via environment variables in `.env`.

> **📖 For detailed documentation on all environment variables, see [docs/environment-variables.md](../../docs/environment-variables.md)**

### Database Configuration

| Variable            | Description       | Example            |
| ------------------- | ----------------- | ------------------ |
| `DATABASE_HOST`     | PostgreSQL host   | `localhost`        |
| `DATABASE_PORT`     | PostgreSQL port   | `5432`             |
| `DATABASE_USER`     | Database user     | `dealbot`          |
| `DATABASE_PASSWORD` | Database password | `dealbot_password` |
| `DATABASE_NAME`     | Database name     | `filecoin_dealbot` |

### Server Configuration

| Variable                  | Description                            | Default                                       |
| ------------------------- | -------------------------------------- | --------------------------------------------- |
| `NODE_ENV`                | Environment mode                       | `development`                                 |
| `DEALBOT_PORT`            | Server port                            | `8080`                                        |
| `DEALBOT_HOST`            | Server host                            | `localhost`                                   |
| `DEALBOT_ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:5173,http://127.0.0.1:5173` |

### Blockchain Configuration

| Variable                      | Description                            | Example                    |
| ----------------------------- | -------------------------------------- | -------------------------- |
| `NETWORK`                     | Filecoin network                       | `calibration` or `mainnet` |
| `WALLET_ADDRESS`              | Your Filecoin wallet address           | `0x...`                    |
| `WALLET_PRIVATE_KEY`          | Your wallet private key (keep secure!) | `0x...`                    |
| `CHECK_DATASET_CREATION_FEES` | Check fees before dataset creation     | `true`                     |
| `ENABLE_IPNI_TESTING`         | IPNI testing mode (`disabled`/`random`/`always`) | `always`          |
| `USE_ONLY_APPROVED_PROVIDERS` | Only use approved storage providers    | `true`                     |

### Scheduling Configuration (pg-boss)

These settings apply when `DEALBOT_JOBS_MODE=pgboss` (recommended). See
[`docs/jobs.md`](../../docs/jobs.md) for scheduling behavior and
[`docs/environment-variables.md`](../../docs/environment-variables.md) for defaults and full definitions.

| Variable                         | Description                              | Recommended |
| -------------------------------- | ---------------------------------------- | ------------------------------ |
| `DEALBOT_JOBS_MODE`              | Enable pg-boss scheduling                 | `pgboss`                       |
| `DEALS_PER_SP_PER_HOUR`          | Deal checks per SP per hour               | `1`                            |
| `RETRIEVALS_PER_SP_PER_HOUR`     | Retrieval checks per SP per hour          | `1`                            |
| `METRICS_PER_HOUR`               | Metrics runs per hour                     | `2`                            |
| `PG_BOSS_LOCAL_CONCURRENCY`      | Per-process `sp.work` concurrency         | `20`                           |
| `JOB_SCHEDULER_POLL_SECONDS`     | Scheduler poll interval                   | `300`                          |
| `JOB_WORKER_POLL_SECONDS`        | Worker poll interval                      | `60`                           |
| `JOB_CATCHUP_MAX_ENQUEUE`        | Max catch-up enqueues per schedule per tick | `10`                         |
| `JOB_SCHEDULE_PHASE_SECONDS`     | Phase offset for multi-deploy staggering  | `0`                            |
| `DEALBOT_PGBOSS_POOL_MAX`        | Max pg-boss DB connections per instance   | `1`                            |
| `DEALBOT_PGBOSS_SCHEDULER_ENABLED` | Enable the enqueue loop                 | `true` (api/both), `false` (worker) |
| `DEALBOT_RUN_MODE`               | Run mode for the application              | `both` (or split api/worker)   |

**Note:** If you run multiple deployments in the same environment, use a non-zero `JOB_SCHEDULE_PHASE_SECONDS` to stagger schedules.

### Dataset Configuration

| Variable                      | Description                                     | Default      |
| ----------------------------- | ----------------------------------------------- | ------------ |
| `DEALBOT_LOCAL_DATASETS_PATH` | Local path for random dataset storage           | `./datasets` |
| `RANDOM_DATASET_SIZES`        | Comma-separated byte sizes for random datasets | `10240,10485760,104857600` |

## Project Structure

```
backend/
├── src/
│   ├── main.ts                 # Application entry point
│   ├── app.module.ts           # Root module
│   ├── app.controller.ts       # Root controller
│   ├── config/                 # Configuration modules
│   ├── database/               # Database entities and migrations
│   ├── deal/                   # Deal creation logic
│   ├── deal-addons/            # Deal add-ons and extensions
│   ├── retrieval/              # Retrieval testing logic
│   ├── retrieval-addons/       # Retrieval add-ons (IPNI)
│   ├── metrics/                # Metrics collection and analytics
│   ├── scheduler/              # Cron job scheduling
│   ├── wallet-sdk/             # Wallet and smart contract operations
│   ├── http-client/            # HTTP client utilities
│   └── common/                 # Shared utilities and decorators
├── test/                       # E2E tests
├── dist/                       # Compiled output (after build)
└── README.md                   # This file
```

## API Documentation

Interactive API documentation is available via Swagger UI:

- **Local:** `http://localhost:8080/api`
- **Production:** `https://dealbot.fwss.io/api`

## Development

### Available Scripts

```bash
pnpm start          # Start in normal mode
pnpm start:dev      # Start with hot-reload (recommended for development)
pnpm start:debug    # Start with debugger
pnpm build          # Build for production
pnpm start:prod     # Run production build
```

### Code Quality

```bash
pnpm format         # Format code with Biome
pnpm format:check   # Check formatting
pnpm lint           # Lint and auto-fix
pnpm lint:check     # Check linting
pnpm check          # Run both format and lint
pnpm check:ci       # CI checks (no auto-fix)
```

### Testing

```bash
pnpm test           # Run unit tests
pnpm test:watch     # Run tests in watch mode
pnpm test:cov       # Run tests with coverage
pnpm test:e2e       # Run end-to-end tests
```

## Database Schema

The application uses TypeORM with PostgreSQL. Key entities:

- **Deal** - Storage deal records
- **Retrieval** - Retrieval test records
- **Provider** - Storage provider information
- **DailyMetric** - Daily performance metrics

Migrations run automatically on application startup.

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
psql -U dealbot -d filecoin_dealbot

# Verify DATABASE_* environment variables in .env
```

### Port Already in Use

```bash
# Change DEALBOT_PORT in .env
# Also update VITE_API_BASE_URL in web/.env
```

### Wallet/Blockchain Issues

```bash
# Verify WALLET_ADDRESS and WALLET_PRIVATE_KEY are correct
# Ensure wallet has sufficient USDFC tokens on the specified NETWORK
```

### CORS Errors from Frontend

```bash
# Add frontend URL to DEALBOT_ALLOWED_ORIGINS in .env
# Example: DEALBOT_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Contributing

See the [main README](../README.md#contributing) for contribution guidelines.

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [Filecoin Documentation](https://docs.filecoin.io/)

## License

Dual-licensed: [MIT](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md), [Apache Software License v2](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md) by way of the [Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
