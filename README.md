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

### Prerequisites

- Node.js 20+
- PostgreSQL
- pnpm
- Filecoin wallet with tokens

### Installation

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

### Running

```bash
# Development
pnpm start

# Production
pnpm start:prod
```

## Docker Deployment

### Building with Docker

To build and run the application with Docker, including version information:

```bash
# Build with version information
docker build \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)" \
  --build-arg GIT_COMMIT_SHORT="$(git rev-parse --short=7 HEAD)" \
  --build-arg GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)" \
  -t dealbot:latest .

# Run the container
docker run -p 3130:3130 --env-file .env dealbot:latest
```

The application will display version information on startup:

```
============================================================
Dealbot Starting...
Version: 0.0.1
Commit: e857fb0e6aa7681e5c680cc8ff0cd0534ecf6c6a (e857fb0)
Branch: main
Build Time: 2025-12-08T20:49:02.808Z
============================================================
```

### Docker Compose

For easier deployment with Docker Compose:

```bash
# Set version information in environment
export GIT_COMMIT="$(git rev-parse HEAD)"
export GIT_COMMIT_SHORT="$(git rev-parse --short=7 HEAD)"
export GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Note:** Make sure to configure your `.env` file with the required environment variables before running Docker Compose.

## Web Dashboard

The project includes a React dashboard for visualizing metrics and monitoring performance.

### Development

```bash
# Terminal 1: Backend
pnpm start

# Terminal 2: Frontend
pnpm dev:web
```

Visit `http://localhost:5173` to view the dashboard.

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

**Local:** `http://localhost:3130/api` (when running locally)

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
| `DEALBOT_PORT`               | Application port         | `3130`  |
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
