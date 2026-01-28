# Local Validation (KIND)

This guide is only for the local KIND cluster. The local overlay already enables dev endpoints and sets long scheduling intervals so you can trigger deals/retrievals manually.

## Prerequisites

- Local KIND cluster running with the `kustomize/overlays/local` overlay. (e.g. `make up`)
- Backend reachable at `http://localhost:3000`.

Get the logs from the backend with `make backend-logs`.

## Endpoints

All endpoints are GET requests.

### List providers

`GET /api/dev/providers`

```bash
curl "http://localhost:3000/api/dev/providers" | jq
```

### Trigger a deal

`GET /api/dev/deal?spAddress=0x...`

```bash
curl "http://localhost:3000/api/dev/deal?spAddress=0x1234..." | jq
```

### Check deal status

`GET /api/dev/deals/:dealId`

```bash
curl "http://localhost:3000/api/dev/deals/550e8400-e29b-41d4-a716-446655440000" | jq
```

### Trigger retrieval

`GET /api/dev/retrieval?dealId=...` or `?spAddress=...`

```bash
curl "http://localhost:3000/api/dev/retrieval?dealId=550e8400-e29b-41d4-a716-446655440000" | jq
curl "http://localhost:3000/api/dev/retrieval?spAddress=0x1234..." | jq
```

## Notes

- The local overlay sets long intervals (2+ hours) so scheduled deals/retrievals do not interfere with manual testing.
- If a request fails, check backend logs for details.
