# Infra Integration

What an operator wiring dealbot into their own cluster needs from the surrounding infrastructure. For the application images and Kubernetes manifests dealbot ships, see [deployment.md](deployment.md).

## System boundary

A running dealbot needs:

- Backend pods (API and worker, see [deployment.md](deployment.md))
- Web pod
- Postgres (required)
- ClickHouse (optional, append-only long-term store)
- A Prometheus scrape path or equivalent for observability

Everything else (ingress controller, secret manager, TLS automation, log shipper, alerting backend, backup tooling) is the operator's choice and is intentionally not prescribed here.

## Ingress

Two public surfaces:

- **Backend API**: HTTP. Used by the web UI and by any external automation. Set `DEALBOT_API_PUBLIC_URL` to the URL the API is reachable at; the web UI reads this to call back. CORS allow-list is driven by `ALLOWED_ORIGINS` (empty disables CORS).
- **Web UI**: static assets served behind a reverse proxy.

TLS termination, ingress controller choice, hostname assignment, and rate limiting are the operator's responsibility.

## Egress

Dealbot dials out; nothing dials into dealbot from SP infrastructure. Egress targets:

- **Chain RPC** (`RPC_URL`): Filecoin EVM RPC. Read and write.
- **PDP Verifier contract** and **FWSS** (on-chain): reached via `RPC_URL`.
- **PDP subgraph** (`PDP_SUBGRAPH_ENDPOINT`): GraphQL.
- **SP HTTP endpoints**: per provider, discovered from chain state. Used for deal creation, retrieval probes, pull checks, piece status.
- **IPNI indexer** (`filecoinpin` / IPNI lookup): used during deal verification and retrieval.

Firewall and proxy rules need to allow outbound HTTPS to arbitrary SP hostnames discovered at runtime.

## Persistence

Postgres is required.

- Enable the `pgcrypto` extension (pg-boss dependency).
- Migrations run on backend startup; the schema is owned by the configured `DATABASE_USER`.
- pg-boss creates its own `pgboss` schema for queue state. Expect steady write churn proportional to job rates.
- Backup posture, HA topology, and DR strategy are operator choice. Dealbot is the only writer in normal operation, so a standard logical backup is sufficient for restore.

ClickHouse is optional and append-only. If `CLICKHOUSE_URL` is unset, ClickHouse writes are disabled and nothing else changes.

## Secrets

The backend Deployment expects a Kubernetes Secret named `dealbot-secrets` populated with the keys in [`apps/backend/.env.example`](../apps/backend/.env.example). Categories:

- **Chain access**: `RPC_URL`, optional API token.
- **Wallet**: `WALLET_PRIVATE_KEY` and/or `SESSION_KEY_PRIVATE_KEY`. See [runbooks/wallet-and-session-keys.md](runbooks/wallet-and-session-keys.md) for lifecycle and rotation.
- **Database**: `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`.
- **Optional sinks**: `CLICKHOUSE_URL`.

Rotation cadence, encryption-at-rest mechanism (SOPS, External Secrets, sealed-secrets, manual), and audit trail are operator choice.

## Observability

Dealbot emits structured logs to stdout (JSON, NestJS Logger format) and Prometheus-style metrics. Metric semantics, label conventions, and per-check timing markers are documented in [docs/checks/events-and-metrics.md](checks/events-and-metrics.md).

Set `DEALBOT_PROBE_LOCATION` to a stable string identifying the cluster or region; it is attached to outbound check metrics and helps correlate SP-side reports.

The Prometheus scrape endpoint shape and stability are in flux. For the current scrape target and any temporary deprecation, check this file's revision history and the worker Deployment manifest in the operating environment.

## Monitoring expectations

At minimum, alert on:

- Job backlog growth in pg-boss (queue depth, oldest queued age)
- Sustained failure rate per check type
- Wallet or session-key readiness (insufficient balance, missing FWSS operator approval)
- Postgres connection or replication lag

Thresholds and alert routing are operator choice.

## DR posture

To restore service after total cluster loss:

1. Restore Postgres from the most recent backup.
2. Redeploy backend, worker, and web pods from pinned semver image tags ([release-process.md](release-process.md)).
3. Re-populate `dealbot-secrets`.
4. Workers resume consuming pg-boss queues from restored state.

ClickHouse and any external log/metric sinks are downstream observers, not sources of truth.

## See also

- [deployment.md](deployment.md): container images, Kustomize manifests, run-mode topology, image tag shapes.
- [docs/jobs.md](jobs.md): pg-boss job set and scheduling behavior.
- [docs/environment-variables.md](environment-variables.md): authoritative env variable reference.
- [docs/architecture.md](architecture.md): component graph.
- [docs/checks/](checks/): per-check semantics and metric definitions.
- [docs/local-monitoring.md](local-monitoring.md): local observability testing.
