# Integration with FilOzone/infra

This repo uses Kustomize for local and production deployments. The base manifests in `kustomize/base/` are intended to be reusable by FilOzone/infra, with overlays providing environment-specific changes.

## Where things live in this repo

- Base manifests: `kustomize/base/backend/`, `kustomize/base/web/`
- Local overlay: `kustomize/overlays/local/`

## What infra can customize

FilOzone/infra can override base manifests via overlays and patches. Common changes include:

- Namespace and naming conventions
- Image registry/repository and tags
- Service types, ports, and ingress configuration
- Environment variables and config maps
- Secrets management (SOPS/External Secrets)
- Resource requests/limits and replica counts
- Removing or replacing base resources (for example, replacing ingress)

## Ingress boundaries

The base Ingress manifests are intentionally minimal and meant to be patched or replaced by infra based on the target environment.

- [kustomize/base/backend/ingress.yaml](../kustomize/base/backend/ingress.yaml)
- [kustomize/base/web/ingress.yaml](../kustomize/base/web/ingress.yaml)

If the environment uses a different ingress controller or routing model, infra can patch or replace these resources.

## Secrets expectations

The backend deployment expects a Secret named `dealbot-secrets`. Infra can supply it via any secret management method (SOPS, External Secrets, or another controller).

For required keys and optional variables, see [apps/backend/.env.example](../apps/backend/.env.example).

## Image tags and promotion

- Main branch builds produce `sha-<sha>` and `sha-<run>-<sha>` tags for staging-style promotion.
- Release builds produce semver tags (`vX.Y.Z`) for production promotion.
- Infra can track SHA tags, semver tags, or pin a specific tag based on environment needs.
- ArgoCD Image Updater is optional; its configuration lives in FilOzone/infra.

## Local vs production notes

- Local overlay uses NodePort services and bundled Postgres for fast iteration.
- Bundled Postgres manifests live in `kustomize/overlays/local/postgres/`.
- Infra typically switches services to ClusterIP, uses managed databases, and injects ingress/TLS settings.

## Planned infra changes: pg-boss job runners

Goal: replace in-process cron with pg-boss. Splitting workers into separate Deployments is a
follow-on step; initial rollout keeps a single backend Deployment.

### Planned application behavior (for infra planning)

- New env vars when pg-boss is enabled:
  - `DEALBOT_JOBS_MODE=pgboss`
  - `METRICS_PER_HOUR`
  - `DEALS_PER_SP_PER_HOUR`
  - `RETRIEVALS_PER_SP_PER_HOUR`
- Deals and retrievals run per storage provider; metrics remain global.
- Scheduling is rate-based (per-hour), with catch-up after downtime.

### Required infra changes in FilOzone/infra

Phase 1 (pg-boss only, single Deployment):
- No infra changes required beyond env vars and database extension enablement.
- Keep the existing API deployment as the only backend pod.
 - Ensure `pgcrypto` extension is enabled in Postgres (pg-boss dependency).

Phase 2 (optional, later): add three worker Deployments (same backend image):
  - `dealbot-deal-worker`
  - `dealbot-retrieval-worker`
  - `dealbot-metrics-worker`
- Keep existing API Deployment and disable job execution there.
- Ensure worker pods do not match the API Service selector:
  - keep API label as `app.kubernetes.io/name: dealbot`
  - use a different label for workers (e.g., `dealbot-worker`)
- Add env overrides per worker:
  - API: `DEALBOT_JOBS_MODE=pgboss`, `DEALBOT_DISABLE_JOBS=true`
  - Deal worker: `DEALBOT_JOBS_MODE=pgboss`, `DEALBOT_JOB_TYPES=deal`
  - Retrieval worker: `DEALBOT_JOBS_MODE=pgboss`, `DEALBOT_JOB_TYPES=retrieval`
  - Metrics worker: `DEALBOT_JOBS_MODE=pgboss`, `DEALBOT_JOB_TYPES=metrics`
  - rate vars: `METRICS_PER_HOUR`, `DEALS_PER_SP_PER_HOUR`, `RETRIEVALS_PER_SP_PER_HOUR`
- Keep a single ConfigMap (`dealbot-env`) and override worker-specific env in patches.
- Ensure `/datasets` volume mount remains on deal/retrieval workers.
- Confirm ServiceMonitor continues to scrape only the API pods.

### Notes / risks

- Multiple replicas per worker type are allowed; pg-boss will handle locking, but
  per-job concurrency limits must be set in the worker config.
- Supabase is on Postgres 17 (per `select version()`); infra should align DB versions.
