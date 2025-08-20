# Mini Deal Bot

<p>
  An automated deal-making bot for the Filecoin Calibration Network built with NestJS and Synapse SDK
</p>

## Description

Mini Deal Bot is an intelligent automation system that creates storage deals on the Filecoin Calibration Network every 30 minutes. It features automated deal creation across multiple storage providers, CDN A/B testing, comprehensive metrics tracking, and uses local datasets for testing storage and retrieval performance.

## Features

- **🔄 Automated Deal Creation**: Creates storage deals every 30 minutes across multiple storage providers
- **📊 CDN A/B Testing**: Randomly enables/disables CDN for performance comparison
- **📈 Comprehensive Metrics**: Tracks ingest latency, storage deal performance, and retrieval metrics
- **🗄️ Local Dataset Support**: Uses pre-loaded datasets (Flickr, Spotify, IMDB) under 250MiB
- **⚡ Synapse SDK Integration**: Leverages Filecoin's Synapse SDK for seamless storage operations
- **🔗 Blockchain Integration**: Uses Filecoin Pay contracts on Calibration Network
- **🏗️ Clean Architecture**: Built with NestJS following clean code principles

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Filecoin wallet with Calibration Network tokens
- pnpm package manager

## Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/FilOzone/dealbot.git
   cd dealbot
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Setup environment variables**

   ```bash
   cp .env.example .env
   ```

   Configure the following in your `.env` file:
   - `WALLET_ADDRESS`: Your Filecoin wallet address
   - `WALLET_PRIVATE_KEY`: Your wallet private key
   - `DATABASE_*`: PostgreSQL connection details
   - `DEALBOT_LOCAL_DATASETS_PATH`: Path to your datasets folder

4. **Setup database**
   ```bash
   # Create PostgreSQL database
   createdb filecoin_dealbot
   ```

## Running the Application

```bash
# Development mode
pnpm run start:dev

# Production mode
pnpm run start:prod

# Debug mode
pnpm run start:debug
```

## Web UI

A single-page React app (Vite + Tailwind + DaisyUI + Recharts) lives in `web/` to visualize `GET api/stats/overall`.

### Dev

1. Backend (Nest):

   ```bash
   # in project root
   cp .env.example .env
   # allow Vite dev origin(s)
   echo "DEALBOT_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173" >> .env
   pnpm install
   pnpm start:dev
   ```

2. Frontend (Vite):

   ```bash
   # in project root
   cp web/.env.example web/.env
   # if backend host/port differs, update VITE_API_BASE_URL in web/.env
   pnpm -C web install
   pnpm -C web dev
   ```

Open http://localhost:5173. The app calls the backend at `VITE_API_BASE_URL` (default http://127.0.0.1:3000).

### Production

1. Build the frontend:

   ```bash
   pnpm -C web build
   ```

2. Start the server (serves `web/dist` at `/` and API at `/stats/*`):

   ```bash
   pnpm start:prod
   ```

### Scripts

From repo root:

- `pnpm dev:web` – run Vite dev server in `web/`
- `pnpm build:web` – build SPA to `web/dist`

## Configuration

### Environment Variables

| Variable                      | Description              | Default         |
| ----------------------------- | ------------------------ | --------------- |
| `NODE_ENV`                    | Environment mode         | `development`   |
| `DEALBOT_PORT`                | Application port         | `8080`          |
| `DEALBOT_HOST`                | Application host         | `127.0.0.1`     |
| `DEAL_INTERVAL_SECONDS`       | Deal creation interval   | `1800` (30 min) |
| `RETRIEVAL_INTERVAL_SECONDS`  | Retrieval test interval  | `3600` (1 hour) |
| `DEALBOT_LOCAL_DATASETS_PATH` | Local datasets directory | `./datasets`    |

### Storage Providers

The bot automatically rotates through configured storage providers in `src/common/providers.ts`. Each provider gets a deal created every 30 minutes with alternating CDN settings for A/B testing.

## Monitoring & Metrics

The bot tracks several key performance indicators:

- **Ingest Latency**: Time from upload start to completion
- **Chain Latency**: Time from piece addition to blockchain confirmation
- **Deal Latency**: Total time from deal creation to confirmation
- **Storage Success Rate**: Percentage of successful deals
- **CDN Performance**: A/B test results comparing CDN vs non-CDN deals

## Architecture

```
src/
├── common/           # Shared constants, providers, and utilities
├── config/           # Application configuration
├── dataSource/       # Dataset management and fetching
├── deal/            # Core deal creation and management
├── domain/          # Business entities, enums, and interfaces
└── main.ts          # Application entry point
```

### Key Components

- **DealService**: Core business logic for deal creation and management
- **DataSourceService**: Handles local dataset fetching and management
- **Deal Entity**: Represents storage deals with comprehensive tracking
- **Synapse SDK Integration**: Manages Filecoin storage operations

## Troubleshooting

### Common Issues

- **Database Connection**: Ensure PostgreSQL is running and credentials are correct
- **Wallet Issues**: Verify wallet has sufficient Calibration Network tokens
- **Dataset Errors**: Check file sizes are under 250MiB and paths are correct
- **Provider Failures**: Some storage providers may be temporarily unavailable

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## Resources

- [Filecoin Documentation](https://docs.filecoin.io/)
- [Synapse SDK](https://github.com/filoz/synapse-sdk)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Filecoin Calibration Network](https://docs.filecoin.io/networks/calibration/)
