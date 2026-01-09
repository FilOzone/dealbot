# Integration with FilOzone/infra

This repo uses Kustomize for local and production deployments. The base manifests in `kustomize/base/` are intended to be reusable by FilOzone/infra, with overlays providing environment-specific changes.

## Where things live in this repo

- Base manifests: `kustomize/base/backend/`, `kustomize/base/web/`, `kustomize/base/postgres/`
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

The base Ingress manifests include annotations that signal what infra should inject.

- [kustomize/base/backend/ingress.yaml](../kustomize/base/backend/ingress.yaml)
- [kustomize/base/web/ingress.yaml](../kustomize/base/web/ingress.yaml)

If the environment uses a different ingress controller or routing model, infra can patch or replace these resources instead of injecting values.

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
- Infra typically switches services to ClusterIP, uses managed databases, and injects ingress/TLS settings.
