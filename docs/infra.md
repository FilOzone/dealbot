# Integration with filoz-infra

This repo ships Helm charts. For local development, this repo installs those charts into a Kind cluster. In `filoz-infra`, production/staging deployments use Kustomize overlays and consume these charts by rendering them to YAML (via `kustomize` `helmCharts:` support or `helm template`) and then applying environment-specific patches/overlays.

## Architecture

**Local Development (this repo)**:
- Two separate Helm charts:
  - `charts/dealbot/` - Backend API service
  - `charts/dealbot-web/` - Web UI frontend
- Uses Kind cluster with bundled PostgreSQL
- NodePort services mapped to:
  - Backend: localhost:8080
  - Web: localhost:3000
- Managed via Makefile targets (`make up`, `make deploy`, etc.)

**Production Deployments (filoz-infra repo)**:
- Kustomize-based manifests in `deployments/kubernetes/`
- Two separate deployments (backend + web)
- Flux CD for GitOps deployment
- SOPS for secret encryption
- Managed PostgreSQL database

## Updating filoz-infra from these Helm charts

When updating the filoz-infra Kustomize manifests based on changes to these Helm charts:

### Step 1: Generate base manifests

**Backend (dealbot)**:
```bash
# From this dealbot repo root
helm template dealbot ./charts/dealbot \
  -f ./charts/dealbot/values.yaml \
  --set postgresql.enabled=false \
  --set ingress.enabled=false \
  --set image.repository=dealbot \
  --set image.tag=latest \
  > /tmp/dealbot-backend-manifests.yaml
```

**Web (dealbot-web)**:
```bash
# From this dealbot repo root
helm template dealbot-web ./charts/dealbot-web \
  -f ./charts/dealbot-web/values.yaml \
  --set ingress.enabled=false \
  --set image.repository=dealbot-web \
  --set image.tag=latest \
  > /tmp/dealbot-web-manifests.yaml
```

### Step 2: Split into separate files

The filoz-infra repo expects separate files per resource type. Split the generated manifests:

```bash
# Example structure in filoz-infra:
# deployments/kubernetes/base/
# ├── dealbot/              (backend)
# │   ├── deployment.yaml
# │   ├── service.yaml
# │   ├── serviceaccount.yaml
# │   ├── configmap.yaml
# │   └── kustomization.yaml
# └── dealbot-web/          (frontend)
#     ├── deployment.yaml
#     ├── service.yaml
#     ├── serviceaccount.yaml
#     └── kustomization.yaml
```

Use `kubectl-slice` or manually split the generated manifests into separate files.

### Step 3: Update kustomization.yaml

Create base kustomization.yaml files for each service:

**Backend** (`base/dealbot/kustomization.yaml`):
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - serviceaccount.yaml
  - configmap.yaml
```

**Web** (`base/dealbot-web/kustomization.yaml`):
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deployment.yaml
  - service.yaml
  - serviceaccount.yaml
```

### Step 4: Key differences to handle

When adapting Helm output for Kustomize, watch for:

1. **ConfigMap (non-secrets)**: Helm creates a `*-env` ConfigMap from chart `values.yaml` `env:`. In filoz-infra, treat these as non-secret env vars and generate a ConfigMap via:
   ```yaml
   # staging/kustomization.yaml
   configMapGenerator:
     - name: dealbot-config
       files:
         - dealbot-config.env
   ```

2. **Secret (secrets only)**: Helm references secrets via `existingSecret`. In filoz-infra, manage secrets via SOPS/External Secrets and create a Secret that matches the name referenced by the deployment:
   ```yaml
   secretGenerator:
     - name: dealbot-secrets
       files:
         - dealbot-secrets.env.encrypted  # SOPS-encrypted
   ```

3. **Image references**: Kustomize overlays replace images for both services:
   ```yaml
   # dealbot/prod/kustomization.yaml
   images:
     - name: dealbot
       newName: 941641221830.dkr.ecr.us-east-1.amazonaws.com/filoz-dealbot
       newTag: latest # {"$imagepolicy": "dealbot:prod-dealbot"}

   # dealbot-web/prod/kustomization.yaml
   images:
     - name: dealbot-web
       newName: 941641221830.dkr.ecr.us-east-1.amazonaws.com/filoz-dealbot-web
       newTag: latest # {"$imagepolicy": "dealbot-web:prod-dealbot-web"}
   ```

4. **Service**: Change from NodePort (local) to ClusterIP (prod)
5. **Resource naming**: Kustomize uses `namePrefix` (e.g., `prod-`, `staging-`)

### Step 5: Test locally before committing

```bash
# From the relevant staging overlay directory in filoz-infra
kustomize build .
kubectl apply --dry-run=server -k .
```

## Initial Deployment to filoz-infra

When deploying dealbot to filoz-infra for the first time:

1. **Create environment-specific config files**:
   ```bash
   # In filoz-infra repo
   touch deployments/kubernetes/us-east-1/f3-passive-testing/dealbot/staging/dealbot-config.env
   touch deployments/kubernetes/us-east-1/f3-passive-testing/dealbot/prod/dealbot-config.env
   ```

2. **Create SOPS-encrypted secrets**:
   ```bash
   # Create unencrypted template
   cat > /tmp/dealbot-secrets.env <<EOF
   WALLET_PRIVATE_KEY=0x...
   WALLET_ADDRESS=f1...
   DATABASE_PASSWORD=...
   EOF

   # Encrypt with SOPS (requires AWS credentials and KMS access)
   cd deployments/kubernetes/us-east-1/f3-passive-testing/dealbot/staging
   sops -e /tmp/dealbot-secrets.env > dealbot-secrets.env.encrypted
   rm /tmp/dealbot-secrets.env
   ```

3. **Set database connection**: Update DATABASE_HOST in config.env to point to managed PostgreSQL (not bundled)

4. **Configure ingress**: Update ingress-patch.yaml with actual hostname and TLS settings

5. **Verify image registry**: Ensure ECR image names match in kustomization.yaml images section

## Key differences

| Aspect | Local (Helm) | Production (Kustomize) |
|--------|--------------|------------------------|
| Tool | Helm charts (2 charts) | Kustomize overlays (2 bases) |
| Secrets | .env → k8s Secret | SOPS-encrypted files |
| Database | Bundled PostgreSQL | Managed database |
| Backend Service | NodePort :30081 → :8080 | ClusterIP :3130 + Ingress |
| Web Service | NodePort :30080 → :3000 | ClusterIP :80 + Ingress |
| CD | Manual (make deploy) | Flux CD |

## Local Development Ports

- **Backend API**: http://localhost:8080 (NodePort 30081 → container 3130)
- **Web UI**: http://localhost:3000 (NodePort 30080 → container 80)
- **PostgreSQL**: localhost:5432 (within cluster only)
