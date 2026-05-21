# Deployment Surface

Dealbot drives automated storage and retrieval traffic against Filecoin storage providers (SPs): it submits deals, runs retrieval probes, and records the outcomes. It ships as two container images (`dealbot-backend`, `dealbot-web`) plus a set of Kustomize manifests that any Kubernetes environment can consume.

## What this repo provides

- Base manifests: `kustomize/base/backend/`, `kustomize/base/web/`
- Local overlay: `kustomize/overlays/local/` (NodePort services, bundled Postgres, split API/worker pods; suitable for `kind`/`minikube`)
- Container images at `ghcr.io/filozone/dealbot-backend` and `ghcr.io/filozone/dealbot-web` with SHA and semver tags ([release-process.md](release-process.md))

The base manifests are intentionally minimal. Anything environment-specific (ingress, TLS, secret backend, replica counts, resource limits, image tags, split-pod topology) is supplied by an overlay.

## Runtime topology

Backend pods select a role via `DEALBOT_RUN_MODE`:

- `api`: serves HTTP. Does not consume pg-boss jobs.
- `worker`: consumes pg-boss jobs. Job set: deal checks, retrieval checks, pull checks, dataset creation, piece cleanup (per provider), pull piece cleanup (global), provider refresh, data retention.
- `both` (default): API listener and worker loop in one pod. Used by the base manifests when `DEALBOT_RUN_MODE` is unset. The local overlay overrides backend to `api` and adds a dedicated worker Deployment.

The pg-boss scheduler that enqueues recurring jobs is gated independently by `DEALBOT_PGBOSS_SCHEDULER_ENABLED` (default `true`). Exactly one pod across the deployment should run the scheduler; on pods that should not, set the flag to `false` explicitly. The local overlay leaves it `true` on the `api` pod and sets `false` on workers.

Per-storage-provider exclusion is enforced inside pg-boss via a singleton queue keyed on SP address, so multiple worker replicas are safe. Job rates are configured via env:

- `DEALS_PER_SP_PER_HOUR`
- `DATASET_CREATIONS_PER_SP_PER_HOUR`
- `RETRIEVALS_PER_SP_PER_HOUR`

Full env contract: [apps/backend/README.md](../apps/backend/README.md#scheduling-configuration-pg-boss) and [docs/environment-variables.md](environment-variables.md). Secret keys (chain endpoints, wallet, database credentials) are listed in [apps/backend/.env.example](../apps/backend/.env.example).

## Operating requirements

- Postgres reachable from the cluster, with the `pgcrypto` extension enabled (pg-boss dependency). The local overlay bundles a Postgres pod; other environments bring their own.
- A Secret named `dealbot-secrets` populated with the keys from `.env.example`. Any mechanism that materializes a Kubernetes Secret with those keys works.

## Image tags

- `sha-<git-sha>` and `sha-<run>-<sha>`: produced for backend or web when a merge to `main` matches the [docker-build](../.github/workflows/docker-build.yml) path filters (the app's directory, or shared workspace files like `pnpm-lock.yaml` / `pnpm-workspace.yaml`). Suitable for staging or preview environments.
- `pre-release-<git-sha>`: produced for merges to the `pre-release` branch. Suitable for opt-in canary environments.
- `vX.Y.Z`: produced by the release workflow when a Release PR merges. Suitable for production.

Overlays can pin a specific tag, track SHA tags via ArgoCD Image Updater, or follow semver. See [release-process.md](release-process.md) for the promotion flow.
