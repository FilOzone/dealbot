# Deal Bot

> Automated Filecoin PDP deal creation and performance monitoring system

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org)

An intelligent automation system for creating and monitoring PDP deals on the Filecoin network. Features automated deal creation, CDN performance testing, comprehensive metrics tracking, and a modern web dashboard.

## Features

- **Automated Deal Creation** - Scheduled storage deals across multiple providers
- **Performance Monitoring** - Real-time metrics for deals and retrievals
- **Add-ons Testing** - FWSS add-ons testing and comparison with provider performance
- **Analytics Dashboard** - Modern React UI with charts and statistics
- **Synapse SDK** - Seamless Filecoin storage operations
- **Smart Contracts** - Automated wallet management and service approvals

## Quick Start

### Option 1: Docker Compose (Recommended for Quick Start)

The easiest way to get started is using Docker Compose, which sets up both PostgreSQL and the application:

#### Prerequisites

- Docker and Docker Compose
- Filecoin wallet with tokens

#### Setup

```bash
# Clone repository
git clone https://github.com/FilOzone/dealbot.git
cd dealbot

# Configure environment
cp .env.example .env
# Edit .env with your wallet credentials
# Database settings are optional - defaults work with docker-compose.dev.yml

# Start services (PostgreSQL + Application)
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f app

# Stop services
docker compose -f docker-compose.dev.yml down

# Stop and remove database volume (fresh start)
docker compose -f docker-compose.dev.yml down -v
```

The application will be available at `http://localhost:8080` (or the port specified in `DEALBOT_PORT`).

**Note:** The database is automatically created and migrations run on first startup. The database data persists in a Docker volume named `postgres_data`.

### Option 2: Local Development

#### Prerequisites

- Node.js 20+
- PostgreSQL (or use Docker for just the database)
- pnpm
- Filecoin wallet with tokens

#### Installation

```bash
# Clone repository
git clone https://github.com/FilOzone/dealbot.git
cd dealbot

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your wallet and database credentials
```

#### Running

```bash
# Development
pnpm start:dev

# Production
pnpm start:prod
```

#### Using Docker for Database Only

If you want to run the app locally but use Docker for PostgreSQL:

```bash
# Start just the database
docker compose -f docker-compose.dev.yml up -d postgres

# Update .env to use localhost for database
# DATABASE_HOST=localhost
# DATABASE_PORT=5432

# Run the app locally
pnpm start:dev
```

## Web Dashboard

The project includes a React dashboard for visualizing metrics and monitoring performance.

### Using Docker Compose

When using `docker-compose.dev.yml`, the web dashboard is automatically built and served by the NestJS application. Simply access:

- **Web UI:** `http://localhost:8080` (or your configured `DEALBOT_PORT`)
- **API Docs:** `http://localhost:8080/api`

### Local Development

For frontend development with hot-reload:

```bash
# Terminal 1: Backend
pnpm start:dev

# Terminal 2: Frontend (with hot-reload)
pnpm dev:web
```

Visit `http://localhost:5173` to view the dashboard with hot-reload.

### Production Build

```bash
# Build frontend
pnpm build:web

# Start server (serves both API and UI)
pnpm start:prod
```

## API Documentation

Complete API documentation is available via Swagger UI:

**Production:** [https://dealbot.fwss.io/api](https://dealbot.fwss.io/api)

**Local (Docker):** `http://localhost:8080/api` (when using docker-compose.dev.yml)

**Local (pnpm):** `http://localhost:3000/api` (when running with pnpm)

## Configuration

Key environment variables:

| Variable                     | Description              | Default |
| ---------------------------- | ------------------------ | ------- |
| `WALLET_ADDRESS`             | Filecoin wallet address  | -       |
| `WALLET_PRIVATE_KEY`         | Wallet private key       | -       |
| `DATABASE_HOST`              | PostgreSQL host          | -       |
| `DATABASE_PORT`              | PostgreSQL port          | -       |
| `DATABASE_USER`              | PostgreSQL user          | -       |
| `DATABASE_PASSWORD`          | PostgreSQL password      | -       |
| `DATABASE_NAME`              | PostgreSQL database name | -       |
| `DEALBOT_PORT`               | Application port         | `3000`  |
| `DEAL_INTERVAL_SECONDS`      | Deal creation interval   | `1800`  |
| `RETRIEVAL_INTERVAL_SECONDS` | Retrieval test interval  | `3600`  |

See `.env.example` for complete configuration options.

## Architecture

```
src/
├── deal/            # Deal creation and management
├── retrieval/       # Storage retrieval testing
├── metrics/         # Performance metrics and analytics
├── scheduler/       # Automated task scheduling
├── wallet-sdk/      # Wallet and contract operations
└── web/             # React dashboard
```

## Monitoring

The system tracks comprehensive metrics:

- **Deal Performance** - Success rates, latencies
- **Retrieval Performance** - TTFB, latency, success rates by service type (cdn)
- **Provider Statistics** - Per-provider performance metrics
- **Network Health** - Overall system health and trends

Access metrics via the web dashboard or API endpoints.

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run formatting and linting checks
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Quality

This project uses [Biome](https://biomejs.dev/) for formatting and linting. Before submitting a PR:

```bash
# Format code
pnpm format

# Check formatting (CI mode)
pnpm format:check

# Lint code
pnpm lint

# Check linting (CI mode)
pnpm lint:check

# Run both format and lint checks
pnpm check

# Run CI checks (same as CI pipeline)
pnpm check:ci
```

Biome is configured to handle TypeScript, React/JSX, and Tailwind CSS with project-specific rules for NestJS decorators and testing files.

## Resources

- [Filecoin Documentation](https://docs.filecoin.io/)
- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [NestJS Documentation](https://docs.nestjs.com/)

## License

Dual-licensed: [MIT](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md), [Apache Software License v2](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md) by way of the [Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
