# Deal Bot Web Dashboard

> Modern React dashboard for monitoring dealbot performance

This is the frontend web application for Deal Bot, built with React, TypeScript, and Vite.

## Tech Stack

- **Framework:** React 19.x
- **Language:** TypeScript 5.x
- **Build Tool:** Vite 7.x
- **Styling:** Tailwind CSS 4.x
- **UI Components:** Radix UI + shadcn/ui
- **Charts:** Recharts
- **Icons:** Lucide React
- **Theme:** next-themes (dark/light mode)

## Prerequisites

- Node.js 20+
- pnpm
- Backend API running (see [`../backend/README.md`](../backend/README.md))

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to point to your backend API:

```env
VITE_API_BASE_URL=http://localhost:8080
```

**Important:** If you changed `DEALBOT_PORT` in the backend, update this URL accordingly.

### 3. Run Development Server

```bash
pnpm dev
```

The dashboard will be available at: `http://localhost:5173`

### 4. Build for Production

```bash
pnpm build
```

Output will be in the `dist/` directory.

### 5. Preview Production Build

```bash
pnpm preview
```

## Configuration

### Environment Variables

| Variable                     | Description                     | Default                 |
| ---------------------------- | ------------------------------- | ----------------------- |
| `VITE_API_BASE_URL`          | Backend API base URL            | `http://localhost:8080` |
| `VITE_PLAUSIBLE_DATA_DOMAIN` | Enable Plausible site analytics | Empty (disabled)        |

All environment variables must be prefixed with `VITE_` to be accessible in the application.

## Development

### Available Scripts

```bash
pnpm dev            # Start development server with HMR
pnpm build          # Build for production
pnpm preview        # Preview production build locally
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

## Connecting to Backend

The frontend communicates with the backend API using the base URL defined in `VITE_API_BASE_URL`.

### API Integration

All API calls should use the base URL from environment variables:

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Example API call
const response = await fetch(`${API_BASE_URL}/deals`);
const deals = await response.json();
```

### CORS Configuration

Ensure the backend's `DEALBOT_ALLOWED_ORIGINS` includes your frontend URL:

```env
# In backend/.env
DEALBOT_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Troubleshooting

### API Connection Issues

```bash
# Verify backend is running
curl http://localhost:8080/api

# Check VITE_API_BASE_URL in .env matches backend port
# Check DEALBOT_ALLOWED_ORIGINS in backend/.env includes frontend URL
```

### Build Errors

```bash
# Clear node_modules and reinstall
rm -rf node_modules
pnpm install

# Clear Vite cache
rm -rf node_modules/.vite
```

### Port Already in Use

```bash
# Vite will automatically try the next available port
# Or specify a different port:
pnpm dev --port 3000
```

## Contributing

See the [main README](../README.md#contributing) for contribution guidelines.

## Resources

- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Recharts Documentation](https://recharts.org/)

## License

Dual-licensed: [MIT](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md), [Apache Software License v2](https://github.com/FilOzone/synapse-sdk/blob/master/LICENSE.md) by way of the [Permissive License Stack](https://protocol.ai/blog/announcing-the-permissive-license-stack/).
