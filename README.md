# Deal Bot

> Automated Filecoin PDP deal creation and performance monitoring system

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org)
[![NestJS](https://img.shields.io/badge/nestjs-11.x-red.svg)](https://nestjs.com)
[![React](https://img.shields.io/badge/react-19.x-blue.svg)](https://react.dev)

An intelligent automation system for creating and monitoring PDP deals on the Filecoin network. Features automated deal creation, CDN performance testing, comprehensive metrics tracking, and a modern web dashboard.

## Features

- **Automated Deal Creation** - Scheduled storage deals across multiple providers
- **Performance Monitoring** - Real-time metrics for deals and retrievals
- **Add-ons Testing** - FWSS add-ons testing and comparison with provider performance
- **Analytics Dashboard** - Modern React UI with charts and statistics

## Project Structure

This is a monorepo containing two separate applications:

```
dealbot/
├── backend/          # NestJS API server (Port 8080)
│   ├── src/
│   │   ├── deal/            # Deal creation and management
│   │   ├── retrieval/       # Storage retrieval testing
│   │   ├── metrics/         # Performance metrics and analytics
│   │   ├── scheduler/       # Automated task scheduling
│   │   └── wallet-sdk/      # Wallet and contract operations
│   └── README.md     # Backend-specific documentation
└── web/              # React + Vite dashboard (Port 5173)
    ├── src/
    └── README.md     # Frontend-specific documentation
```

## Quick Start

### Option 1: Docker Compose (Recommended for Quick Start)

- **Node.js** 20+
- **pnpm** (package manager)
- **PostgreSQL** database
- **Filecoin wallet** with tokens (for Calibration or Mainnet)

### 1. Clone the Repository

```bash
git clone https://github.com/FilOzone/dealbot.git
cd dealbot
```

### 2. Install Dependencies

```bash
# Install dependencies
pnpm install
```

### 3. Set Up Environment Variables

#### Backend Configuration

```bash
cd apps/backend
cp .env.example .env
# Edit .env with your database credentials, wallet info, etc.
```

**Key variables to configure:**

- `DATABASE_*` - PostgreSQL connection details
- `WALLET_ADDRESS` & `WALLET_PRIVATE_KEY` - Your Filecoin wallet
- `NETWORK` - `calibration` or `mainnet`
- `DEALBOT_PORT` - Backend server port (default: `8080`)

See [`backend/.env.example`](backend/.env.example) for all options.

#### Frontend Configuration

```bash
cd ../web
cp .env.example .env
# Update VITE_API_BASE_URL if you changed DEALBOT_PORT
```

Default: `VITE_API_BASE_URL=http://localhost:8080`

### 4. Run the Applications

#### Option 1: Run both applications from Root

```bash
pnpm start:dev
```

Backend runs at: `http://localhost:8080` ( or at DEALBOT_PORT environment variable)
Frontend runs at: `http://localhost:5173`

#### Option 2: Run both applications separately in different terminals

Open **two terminal windows**:

##### Terminal 1: Backend (API Server)

```bash
cd apps/backend
pnpm start:dev    # Development with hot-reload
```

Backend runs at: `http://localhost:8080`
API Docs (Swagger): `http://localhost:8080/api`

##### Terminal 2: Frontend (Web Dashboard)

```bash
cd apps/web
pnpm dev          # Development server
```

Frontend runs at: `http://localhost:5173`

## Production Deployment

### Build Both Applications

```bash
# Build
pnpm build
```

### Run Production Builds

#### Option 1: Run both applications from Root

```bash
pnpm start:prod
```

#### Option 2: Run both applications separately

Open **two terminal windows**:

```bash
# Terminal 1: Backend (API Server)
cd apps/backend
pnpm start:prod

# Terminal 2: Frontend (preview)
cd apps/web
pnpm preview
```

## API Documentation

Complete API documentation is available via Swagger UI:

- **Production:** [https://dealbot.fwss.io/api](https://dealbot.fwss.io/api)
- **Local:** `http://localhost:8080/api` (when running locally)

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

Both `backend/` and `web/` use [Biome](https://biomejs.dev/) for formatting and linting. Before submitting a PR, run checks in both directories:

```bash
# In backend/ or web/ directory
pnpm format        # Format code
pnpm format:check  # Check formatting (CI mode)
pnpm lint          # Lint code
pnpm lint:check    # Check linting (CI mode)
pnpm check         # Run both format and lint checks
pnpm check:ci      # Run CI checks (same as CI pipeline)
```

Biome is configured to handle TypeScript, React/JSX, and Tailwind CSS with project-specific rules for NestJS decorators and testing files.

## Resources

- [Filecoin Documentation](https://docs.filecoin.io/)
- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [NestJS Documentation](https://docs.nestjs.com/)

## License

Dual-licensed: [MIT](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md), [Apache Software License v2](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md) by way of the [Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
