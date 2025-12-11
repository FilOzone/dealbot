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

All configuration is done via environment variables in `.env`:

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
| `ENABLE_CDN_TESTING`          | Enable CDN retrieval testing           | `true`                     |
| `ENABLE_IPNI_TESTING`         | Enable IPNI retrieval testing          | `true`                     |
| `USE_ONLY_APPROVED_PROVIDERS` | Only use approved storage providers    | `true`                     |

### Scheduling Configuration

Control when and how often automated jobs run:

| Variable                         | Description                       | Default (seconds) |
| -------------------------------- | --------------------------------- | ----------------- |
| `DEAL_INTERVAL_SECONDS`          | How often to create new deals     | `1800` (30 min)   |
| `RETRIEVAL_INTERVAL_SECONDS`     | How often to test retrievals      | `3600` (60 min)   |
| `DEAL_START_OFFSET_SECONDS`      | Delay before first deal creation  | `0`               |
| `RETRIEVAL_START_OFFSET_SECONDS` | Delay before first retrieval test | `300` (5 min)     |
| `METRICS_START_OFFSET_SECONDS`   | Delay before first metrics job    | `600` (10 min)    |

**Note:** Offsets prevent concurrent execution of multiple jobs at startup.

### Dataset Configuration

| Variable                      | Description                    | Default      |
| ----------------------------- | ------------------------------ | ------------ |
| `DEALBOT_LOCAL_DATASETS_PATH` | Local path for dataset storage | `./datasets` |
| `KAGGLE_DATASET_TOTAL_PAGES`  | Number of Kaggle dataset pages | `500`        |

### Proxy Configuration (Optional)

For retrieval testing through proxies:

| Variable          | Description                                      | Example                                 |
| ----------------- | ------------------------------------------------ | --------------------------------------- |
| `PROXY_LIST`      | Comma-separated proxy URLs                       | `http://user:pass@host:port,http://...` |
| `PROXY_LOCATIONS` | Comma-separated location identifiers for proxies | `us-east,eu-west`                       |

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
│   ├── retrieval-addons/       # Retrieval add-ons (CDN, IPNI)
│   ├── metrics/                # Metrics collection and analytics
│   ├── scheduler/              # Cron job scheduling
│   ├── wallet-sdk/             # Wallet and smart contract operations
│   ├── http-client/            # HTTP client utilities
│   ├── proxy/                  # Proxy management
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
