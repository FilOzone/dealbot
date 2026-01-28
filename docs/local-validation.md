# Local Validation Guide

This guide explains how to use the dev-only endpoints to manually trigger deals and retrievals for specific Storage Providers (SPs) during local development and testing.

## Prerequisites

- Running dealbot cluster (local or k8s)
- Database with existing provider data
- Valid wallet configuration (WALLET_ADDRESS, WALLET_PRIVATE_KEY)

## Enabling Dev Mode

### Kind cluster (local k8s)

Dev mode is **enabled by default** in the local kustomize overlay. No additional configuration needed.

### Local pnpm dev

When running with `pnpm dev` (without k8s), add the following to your `apps/backend/.env` file:

```bash
# Enable dev mode endpoints
ENABLE_DEV_MODE=true

# CDN/IPNI settings (optional)
ENABLE_CDN_TESTING=false
ENABLE_IPNI_TESTING=always
```

**Note:** When `ENABLE_DEV_MODE` is not set or set to `false`, the `/api/dev/*` endpoints will return 404.

## Standing Up Local Cluster

### Using pnpm directly

```bash
# Navigate to backend
cd apps/backend

# Copy and configure environment
cp .env.example .env
# Edit .env with your database credentials and ENABLE_DEV_MODE=true

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Using kind cluster (recommended for full stack testing)

```bash
# From repository root

# Create kind cluster and deploy everything
make up

# Or if cluster already exists, just rebuild and redeploy
make redeploy
```

The kind cluster exposes everything on `http://localhost:3000` (the web frontend proxies API requests to the backend).

The local kustomize overlay (`kustomize/overlays/local`) includes these defaults:
- `ENABLE_DEV_MODE=true` - Dev endpoints enabled
- `DEAL_INTERVAL_SECONDS=3600` - Automatic deals every 1 hour
- `RETRIEVAL_INTERVAL_SECONDS=7200` - Automatic retrievals every 2 hours
- `ENABLE_CDN_TESTING=false` - CDN disabled
- `ENABLE_IPNI_TESTING=always` - IPNI always enabled

**Note:** You still need wallet credentials in your `.env` file (WALLET_ADDRESS, WALLET_PRIVATE_KEY) as these are loaded as secrets.

### Database Setup

Ensure your database is running and has the required schema:

```bash
# Run migrations
pnpm migration:run
```

## API Endpoints

All endpoints are GET requests with query parameters for easy browser or curl access.

**Port:** All API requests go through `http://localhost:3000` (the frontend proxies to the backend).

### List Providers

Returns all available storage providers for testing.

**Endpoint:** `GET /api/dev/providers`

**Browser:**
```
http://localhost:3000/api/dev/providers
```

**curl:**
```bash
curl "http://localhost:3000/api/dev/providers" | jq
```

**Response:**
```json
[
  {
    "id": 1,
    "serviceProvider": "0x1234...",
    "name": "Provider Name",
    "description": "Provider description",
    "active": true,
    "isApproved": true,
    "products": { ... }
  }
]
```

### Trigger Deal

Starts a deal with a specific storage provider. **Returns immediately** with a deal ID - processing happens in the background.

**Endpoint:** `GET /api/dev/deal`

**Query Parameters:**
| Name | Required | Description |
|------|----------|-------------|
| `spAddress` | Yes | Storage provider address (0x...) |

**Browser:**
```
http://localhost:3000/api/dev/deal?spAddress=0x1234567890abcdef1234567890abcdef12345678
```

**curl:**
```bash
curl "http://localhost:3000/api/dev/deal?spAddress=0x1234..." | jq
```

**Response (immediate):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pieceCid": "",
  "status": "pending",
  "fileName": "pending",
  "fileSize": 0,
  "serviceTypes": [],
  "spAddress": "0x1234..."
}
```

### Check Deal Status

Poll for deal completion using the deal ID.

**Endpoint:** `GET /api/dev/deals/:dealId`

**Path Parameters:**
| Name | Required | Description |
|------|----------|-------------|
| `dealId` | Yes | Deal ID from trigger deal response |

**Browser:**
```
http://localhost:3000/api/dev/deals/550e8400-e29b-41d4-a716-446655440000
```

**curl:**
```bash
curl "http://localhost:3000/api/dev/deals/550e8400-e29b-41d4-a716-446655440000" | jq
```

**Response (when complete):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "pieceCid": "baga6ea4seaq...",
  "status": "deal_created",
  "fileName": "random-2024-01-15T10-30-00-000Z-abc123.bin",
  "fileSize": 10485760,
  "dealLatencyMs": 5234,
  "ingestLatencyMs": 3421,
  "serviceTypes": ["direct_sp", "ipfs_pin"],
  "spAddress": "0x1234..."
}
```

### Trigger Retrieval

Tests all retrieval methods for a specific deal or the most recent deal for an SP.

**Endpoint:** `GET /api/dev/retrieval`

**Query Parameters:**
| Name | Required | Description |
|------|----------|-------------|
| `dealId` | No* | Specific deal ID to retrieve |
| `spAddress` | No* | Uses most recent deal for this SP |

*One of `dealId` or `spAddress` is required.

**Browser (by SP address):**
```
http://localhost:3000/api/dev/retrieval?spAddress=0x1234...
```

**Browser (by deal ID):**
```
http://localhost:3000/api/dev/retrieval?dealId=550e8400-e29b-41d4-a716-446655440000
```

**curl:**
```bash
# By SP address (uses most recent deal)
curl "http://localhost:3000/api/dev/retrieval?spAddress=0x1234..." | jq

# By specific deal ID
curl "http://localhost:3000/api/dev/retrieval?dealId=uuid-here" | jq
```

**Response:**
```json
{
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "pieceCid": "baga6ea4seaq...",
  "spAddress": "0x1234...",
  "results": [
    {
      "method": "direct_sp",
      "success": true,
      "url": "https://sp.example.com/piece/...",
      "latencyMs": 1234,
      "ttfbMs": 156,
      "throughputBps": 8500000,
      "statusCode": 200,
      "responseSize": 10485760
    },
    {
      "method": "cdn",
      "success": true,
      "url": "https://cdn.example.com/...",
      "latencyMs": 456,
      "ttfbMs": 89,
      "throughputBps": 23000000,
      "statusCode": 200,
      "responseSize": 10485760,
      "retryCount": 1
    },
    {
      "method": "ipfs_pin",
      "success": false,
      "url": "https://ipfs.example.com/ipfs/...",
      "error": "timeout waiting for response"
    }
  ],
  "summary": {
    "totalMethods": 3,
    "successfulMethods": 2,
    "failedMethods": 1,
    "fastestMethod": "cdn",
    "fastestLatency": 456
  },
  "testedAt": "2024-01-15T10:35:00.000Z"
}
```

## Watching Logs

### Local development (pnpm)

Logs appear directly in the terminal where you ran `pnpm dev`.

### Kind cluster

```bash
# Using make target (recommended)
make backend-logs

# Or using kubectl directly
kubectl logs -f -n dealbot deploy/dealbot
```

### Filtering for dev-tools activity

```bash
# kind cluster
make backend-logs 2>&1 | grep -E "(DevTools|dev-tools|Triggering)"

# local pnpm dev
pnpm dev 2>&1 | grep -E "(DevTools|dev-tools|Triggering)"
```

## Interpreting Results

### Deal Response Fields

| Field | Description |
|-------|-------------|
| `id` | Unique deal identifier (UUID) |
| `pieceCid` | Content identifier for the uploaded piece |
| `status` | Deal status (`pending`, `uploaded`, `piece_added`, `deal_created`, `failed`) |
| `fileName` | Name of the uploaded file |
| `fileSize` | Size of the uploaded file in bytes |
| `dealLatencyMs` | Total time for deal creation |
| `ingestLatencyMs` | Time for data upload to SP |
| `serviceTypes` | Array of services applied (`direct_sp`, `cdn`, `ipfs_pin`) |
| `errorMessage` | Error details if deal failed |

### Retrieval Response Fields

| Field | Description |
|-------|-------------|
| `method` | Retrieval method (`direct_sp`, `cdn`, `ipfs_pin`) |
| `success` | Whether retrieval succeeded |
| `latencyMs` | Total retrieval time |
| `ttfbMs` | Time to first byte |
| `throughputBps` | Bytes per second |
| `statusCode` | HTTP status code |
| `responseSize` | Size of retrieved data |
| `retryCount` | Number of retry attempts (0 = first attempt succeeded) |
| `error` | Error message if retrieval failed |

## Troubleshooting

### Endpoints return 404

The dev tools module is not loaded. Verify:
1. `ENABLE_DEV_MODE=true` is set in your `.env`
2. Restart the backend after changing the environment variable

### SP not found

The storage provider address is not in the provider cache. This can happen if:
1. The SP is not registered on-chain
2. The SP is not active
3. Provider loading failed at startup - check logs for errors

### Deal creation fails

Common causes:
1. **Insufficient wallet funds** - Check wallet balance and allowances
2. **SP not accepting deals** - The SP may be offline or at capacity
3. **Network issues** - Check connectivity to the blockchain RPC
4. **Invalid data size** - Ensure data meets SP requirements

### Retrieval timeouts

1. **SP offline** - Direct retrieval requires the SP to be online
2. **CDN cache miss** - First request may be slow while caching
3. **IPNI not indexed** - IPNI retrieval requires the piece to be advertised

### No successful deals found for SP

When using `spAddress` for retrieval, there must be at least one deal with status `deal_created` or `piece_added` for that SP. Create a new deal first.

## Security Notes

**Important:** The dev tools endpoints are designed for local development only.

- Never enable `ENABLE_DEV_MODE=true` in production
- The endpoints bypass normal scheduling and rate limiting
- Deal creation uses configured wallet credentials
- No authentication is required for these endpoints
