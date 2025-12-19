# Local Kubernetes Development (Kind + Kustomize)

This repo uses Kustomize for both local and production deployments. Local clusters use the `kustomize/overlays/local` overlay; `filozone/infra` uses the base manifests with production-specific overlays.

## Prerequisites
- Docker, Kind, kubectl, make installed.

## One-time setup
```bash
make kind-up
cp .env.example .env
# Edit .env to add your WALLET_PRIVATE_KEY and WALLET_ADDRESS
```
This creates the Kind cluster (`dealbot-local`).
Local ports (via `kind-config.yaml` extraPortMappings): web UI at http://localhost:3000, backend API at http://localhost:8080.
If you see `Unexpected token '<'` in the browser console, the frontend is hitting the web server instead of the API; either rely on the web container's `/api*` reverse proxy, or set `VITE_API_BASE_URL=http://localhost:8080` for the web deployment.

## Secrets (wallets are required, DB password is optional)
Secrets are provided via a Kubernetes Secret created from your local `.env` file.

```bash
cp .env.example .env            # if you don't already have one
echo "WALLET_PRIVATE_KEY=..." >> .env
echo "WALLET_ADDRESS=..." >> .env
# Optional: add DATABASE_PASSWORD if using an external DB (or a non-default password)
echo "DATABASE_PASSWORD=..." >> .env
make secret                     # uses SECRET_ENV_FILE=.env by default
```
The `make secret` target will only include secret keys (wallet + optional DATABASE_PASSWORD) so your `.env` won't override non-secret configuration.
For running services directly (outside Kubernetes), use `apps/backend/.env.example` and `apps/web/.env.example` instead.

**Note**: The bundled PostgreSQL uses `dealbot_password` and the backend defaults to that value if `DATABASE_PASSWORD` is unset. Only set `DATABASE_PASSWORD` when you need something else (external DB or non-default password).

## Build and deploy locally
```bash
make image-build                                    # builds backend + web images
make kind-load                                      # load the images into Kind
make deploy                                         # creates secret, then kubectl apply -k
```
Access the app at http://localhost:3000.

If you rebuilt an image but Kubernetes is still serving old behavior, use:
```bash
make redeploy                                       # rebuild + kind-load + kubectl apply + rollout restart
```

Shortcut (after the cluster exists): one command builds, loads, creates secrets, and deploys:
```bash
make local-up
```

Sugar commands:
- `make up`   -> kind-up + local-up (cluster + secrets + build/load + deploy)
- `make down` -> undeploy app and delete the Kind cluster

## Customizing local configuration
The local overlay is in `kustomize/overlays/local/`. To customize configuration:

1. **Environment variables**: Edit `kustomize/overlays/local/backend-configmap-local.yaml`
2. **Service ports**: Edit `kustomize/overlays/local/backend-service-nodeport.yaml` or `web-service-nodeport.yaml`
3. **Image tags**: Images are configured in `kustomize/overlays/local/kustomization.yaml`

After making changes, run `make deploy` to apply them.

## Values and configuration
- Backend base: `kustomize/base/backend/`
- Backend local overlay: `kustomize/overlays/local/backend-configmap-local.yaml`
- Web base: `kustomize/base/web/`
- Web local overlay: `kustomize/overlays/local/web-service-nodeport.yaml`

The local overlay automatically:
- Uses NodePort services for local access (backend :30081 → :8080, web :30080 → :3000)
- Deploys PostgreSQL with persistent storage
- Points backend to the local PostgreSQL instance
- Uses local image tags (`dealbot-local:dev`, `dealbot-web-local:dev`)

If you see `ErrImagePull` for `dealbot-local:dev`, rebuild and reload into Kind before deploying:
```bash
make image-build
make kind-load
make deploy
```

After changing Kind config or the service NodePort, recreate the cluster to pick up port mappings:
```bash
make down
make up
```

## Managing the release
```bash
make logs       # follow application logs (shows help for backend/web logs)
make backend-logs  # follow backend logs
make web-logs      # follow web logs
make undeploy   # kubectl delete -k
make kind-down  # delete the Kind cluster
```

## Managing the local database

### Persistence
The local PostgreSQL deployment uses persistent storage (PersistentVolumeClaim) to preserve data across pod restarts and redeployments. In Kind clusters, the local-path-provisioner stores data inside the kind node container at `/var/local-path-provisioner/`.

**Where the data actually lives:**
- **All platforms (macOS/Linux/Windows)**: Data is stored inside the Docker container running the kind node, backed by Docker volumes
- To inspect the data location: `docker exec -it dealbot-local-control-plane ls -la /var/local-path-provisioner/`
- To find the backing Docker volume: `docker inspect dealbot-local-control-plane | grep -A 5 Mounts`

**Important**: The data persists as long as the kind cluster exists. Running `make kind-down` will destroy the cluster and all data. Use `make undeploy` to remove the app while keeping the cluster and data intact.

### Resetting the database
To start with a fresh database (clear all data):
```bash
# Delete the persistent volume claim
kubectl delete pvc -n dealbot dealbot-postgres

# Restart the postgres deployment to recreate the PVC
kubectl rollout restart deployment -n dealbot dealbot-postgres

# Migrations will run automatically when the backend pod starts
```

### Accessing the database directly
```bash
# Connect to postgres pod
kubectl exec -it -n dealbot deployment/dealbot-postgres -- psql -U dealbot -d filecoin_dealbot
```

## Rendering manifests
To see the final manifests that will be applied:
```bash
make render
# or
kubectl kustomize kustomize/overlays/local
```

## SOPS/External Secrets parity
If you want to reuse SOPS-managed secrets from the infra repo:
```bash
sops -d path/to/dealbot.enc.yaml > /tmp/dealbot-secrets.env
kubectl -n dealbot create secret generic dealbot-secrets --from-env-file=/tmp/dealbot-secrets.env
make deploy SECRET_NAME=dealbot-secrets
```
If you prefer External Secrets, install the operator in Kind, have it create the Secret, and set `SECRET_NAME` accordingly.
