# Infra Integration

What an operator wiring dealbot into their own cluster needs from the surrounding infrastructure. For the application images and Kubernetes manifests dealbot ships, see [deployment.md](deployment.md). For the authoritative env variable reference, see [environment-variables.md](environment-variables.md).

## System boundary

A running dealbot needs:

- Backend pods (API and worker; see [deployment.md](deployment.md))
- Web pod
- Postgres (required)
- ClickHouse (optional, append-only sink)
- A way to scrape or ship the metrics dealbot emits (see [Observability](#observability))

Everything else (ingress controller, secret manager, TLS automation, log shipper, alerting backend, backup tooling) is the operator's choice and is intentionally not prescribed here.

## Network

### Ingress

Two public surfaces dealbot itself listens on:

- **Backend API** (`apps/backend`): served on `DEALBOT_PORT`. Used by the web UI and any external automation. CORS allow-list is `DEALBOT_ALLOWED_ORIGINS` (comma-separated; empty disables CORS entirely).
- **Web UI** (`apps/web`): static assets served behind a reverse proxy. The web UI reaches the "backend API" above at the URL baked in via `VITE_API_BASE_URL` (build-time) or supplied at runtime.

[Pull checks](checks/pull-check.md) require **inbound reachability from storage providers**: during a pull check dealbot hands the SP a source URL of the form `<DEALBOT_API_PUBLIC_URL>/api/piece/<pieceCid>` and the SP fetches that endpoint. `DEALBOT_API_PUBLIC_URL` must therefore be a URL routable from SP networks, not just from inside the cluster.

TLS termination, ingress controller choice, hostname assignment, and rate limiting are the operator's responsibility.

### Egress

Dealbot opens outbound connections to:

- **Chain RPC** (`RPC_URL`): Filecoin EVM RPC for reads and writes. Reaches the **PDP Verifier contract** and **FWSS**.
- **PDP subgraph** (`PDP_SUBGRAPH_ENDPOINT`): GraphQL.
- **Storage provider HTTP endpoints**: per-provider URLs discovered from chain state. Used for deal creation, retrieval probes, pull-check kickoff, and piece status. Hostnames are not known in advance, so firewall and proxy rules need to allow outbound network access to arbitrary SP hostnames discovered at runtime.
- **IPNI indexer (`filecoinpin.contact`)**: looked up during deal verification and retrieval to confirm SPs are advertising the content.
- **ClickHouse** (optional, `CLICKHOUSE_URL`).

## Persistence

Postgres is required.

- Required extension: `pgcrypto`.
- Schema migrations are run by the backend on startup in production from non-worker pods (`runMode != worker`). Worker pods assume migrations have already run and the `pgboss` schema exists.
- pg-boss owns its own schema for queue state. Expect steady write churn proportional to job rates.
- Backup, high-availability topology, and disaster-recovery strategy are operator choice. Dealbot is the only writer in normal operation, so a standard logical backup is sufficient for restore.

ClickHouse is optional and append-only. If `CLICKHOUSE_URL` is unset, ClickHouse writes are disabled and nothing else changes.

## Secrets

[environment-variables.md](environment-variables.md) is the authoritative env contract; [apps/backend/.env.example](../apps/backend/.env.example) is a starting set.

The backend Deployment expects a Kubernetes Secret named `dealbot-secrets`. Populate it with the sensitive values: `DATABASE_PASSWORD`, one of `WALLET_PRIVATE_KEY` or `SESSION_KEY_PRIVATE_KEY`, and any credentials embedded in `RPC_URL` or `CLICKHOUSE_URL`. Non-sensitive config (`DATABASE_HOST`, `NETWORK`, etc.) can live in a ConfigMap or plain env.

Rotation cadence, encryption-at-rest mechanism (SOPS, External Secrets, sealed-secrets, manual), and audit trail are operator choice. Wallet and session-key lifecycle is in [runbooks/wallet-and-session-keys.md](runbooks/wallet-and-session-keys.md).

## Observability

Dealbot emits:

- Structured logs to stdout (JSON, NestJS Logger format).
- Prometheus-style metrics. Names, labels, and per-check timing markers are documented in [docs/checks/events-and-metrics.md](checks/events-and-metrics.md).

Set `DEALBOT_PROBE_LOCATION` to a stable string identifying the cluster or region. When `CLICKHOUSE_URL` is configured, it is written as the `probe_location` column on every check row, which lets multi-region deployments be partitioned and compared.

The metrics surface is under active rework. For a current example of how the local stack scrapes and visualizes metrics, see [local-monitoring.md](local-monitoring.md). Operators should expect the production wiring to follow the same shape but should not assume a specific endpoint path or port.

## Monitoring expectations

At minimum, alert on:

- pg-boss backlog growth (queue depth, oldest queued age)
- Sustained failure rate per check type
- Wallet or session-key readiness (insufficient balance, missing FWSS operator approval)
- Active Dealbot data sets accumulating above `MIN_NUM_DATASETS_FOR_CHECKS` per provider, and stale active-data-set inventory collection
- Postgres connection or replication health

Thresholds and alert routing are operator choice.

## Disaster Recovery posture

To restore service after total cluster loss:

1. Restore Postgres from the most recent backup.
2. Redeploy backend, worker, and web pods from pinned semver image tags ([release-process.md](release-process.md)).
3. Re-populate `dealbot-secrets`.
4. Workers resume consuming pg-boss queues from restored state.

ClickHouse and any external log or metric sinks are downstream observers, not sources of truth.

## See also

For related context:

- [deployment.md](deployment.md): container images, Kustomize manifests, run-mode topology, image tag shapes.
- [docs/jobs.md](jobs.md): pg-boss job set and scheduling behavior.
- [docs/environment-variables.md](environment-variables.md): authoritative env variable reference.
- [docs/architecture.md](architecture.md): component graph and data-store ownership.
- [docs/checks/](checks/): per-check semantics and metric definitions.
- [docs/local-monitoring.md](local-monitoring.md): example metrics scrape and dashboards for the local overlay.
