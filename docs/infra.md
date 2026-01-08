# Integration with filozone/infra

This repo uses Kustomize for both local and production deployments. The base manifests (`kustomize/base/`) can be directly referenced by `filozone/infra` with production-specific overlays.

## Architecture

**Local Development (this repo)**:
- Base manifests in `kustomize/base/backend/` and `kustomize/base/web/`
- Local overlay in `kustomize/overlays/local/`
- Uses Kind cluster with bundled PostgreSQL (`kustomize/base/postgres/`)
- NodePort services mapped to:
  - Backend: localhost:8080
  - Web: localhost:3000
- Managed via Makefile targets (`make up`, `make deploy`, etc.)

**Production Deployments (filozone/infra repo)**:
- References this repo's base manifests as remote resources
- Applies production-specific overlays (ClusterIP services, Ingress, image tags, etc.)
- Flux CD for GitOps deployment
- SOPS for secret encryption
- Managed PostgreSQL database

## Service Ownership: Ingress Boundaries

This repo follows the service ownership model where:

**Service Repo (i.e., this FilOzone/dealbot repo) OWNS**:
- Base Ingress resources with portable definitions
- Service routing within namespace boundary (service name/port)
- Placeholder hostnames (e.g., `dealbot.example.com`)
- Annotations signaling what infra should inject

**Infra Repo (i.e., FilOzone/infra) INJECTS**:
- Real hostnames via patches
- TLS configuration (cert-manager annotations, secretName)
- IngressClass specification
- Security policies (rate limits, WAF rules, etc.)

### Ingress Annotation Signals

The base Ingress manifests use annotations to signal injection requirements.  For example if the base has:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dealbot-web
  annotations:
    # Signals to infra repo
    filozone.io/inject-hostname: "true"
    filozone.io/inject-tls: "true"
    filozone.io/inject-ingress-class: "true"
    filozone.io/inject-security-policy: "true"
spec:
  rules:
    - host: dealbot.example.com  # Placeholder
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: dealbot-web
                port:
                  name: http
```

The FilOzone/infra repo will patch these Ingress resources to inject production values:

```yaml
# filozone/infra overlay patch example
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dealbot-web
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - dealbot.staging.filozone.io
      secretName: dealbot-web-tls
  rules:
    - host: dealbot.staging.filozone.io  # Real hostname
      # paths inherited from base
```

This boundary allows:
- **Local development**: Can reproduce everything except ingress (which differs from production)
- **Service portability**: Base manifests work in any cluster
- **Infra control**: Central management of hostnames, TLS, and security policies

## Using these manifests in filozone/infra

The filozone/infra repo can reference the base manifests in this repo using one of two approaches:

### Option 1: Direct GitHub reference (Recommended)

In your `filozone/infra` Kustomize overlay:

```yaml
# filozone/infra: deployments/kubernetes/dealbot/staging/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: dealbot-staging

resources:
  # Reference base manifests from GitHub
  - https://github.com/filozone/dealbot//kustomize/base/backend?ref=v0.2.0
  - https://github.com/filozone/dealbot//kustomize/base/web?ref=v0.2.0

# Override images with production tags
images:
  - name: dealbot
    newName: ghcr.io/filozone/dealbot-backend
    newTag: v0.2.0
  - name: dealbot-web
    newName: ghcr.io/filozone/dealbot-web
    newTag: v0.2.0

# Apply production patches
patches:
  - path: backend-service-clusterip.yaml
  - path: web-service-clusterip.yaml
  - path: backend-ingress-patch.yaml
  - path: web-ingress-patch.yaml
  - path: backend-configmap-prod.yaml

# Secrets managed by SOPS/External Secrets
secretGenerator:
  - name: dealbot-secrets
    files:
      - dealbot-secrets.env  # SOPS-encrypted
```

### Option 2: Copy base manifests locally

If you prefer to copy the manifests into filozone/infra:

```bash
# In filozone/infra repo
mkdir -p deployments/kubernetes/dealbot/base
cp -r /path/to/dealbot/kustomize/base/* deployments/kubernetes/dealbot/base/
```

Then reference them locally:

```yaml
# filozone/infra: deployments/kubernetes/dealbot/staging/kustomization.yaml
resources:
  - ../base/backend
  - ../base/web
```

## Key differences between local and production

| Aspect | Local (this repo) | Production (filozone/infra) |
|--------|-------------------|------------------------------|
| Tool | Kustomize overlay | Kustomize overlay |
| Secrets | .env → k8s Secret | SOPS-encrypted files |
| Database | Bundled PostgreSQL | Managed database |
| Backend Service | NodePort :30081 → :8080 | ClusterIP :3130 + Ingress |
| Web Service | NodePort :30080 → :3000 | ClusterIP :80 + Ingress |
| Images | Local tags (`dealbot-local:dev`) | GHCR tags (`ghcr.io/filozone/dealbot-backend:v0.2.0`) |
| CD | Manual (make deploy) | Flux CD |

## Example production overlay structure

```
filozone/infra/deployments/kubernetes/dealbot/
├── staging/
│   ├── kustomization.yaml          # References base + applies staging patches
│   ├── backend-configmap-staging.yaml
│   ├── backend-ingress-patch.yaml  # Injects real hostname, TLS, security
│   ├── web-ingress-patch.yaml      # Injects real hostname, TLS
│   ├── backend-service-clusterip.yaml
│   ├── web-service-clusterip.yaml
│   └── dealbot-secrets.env         # SOPS-encrypted
└── prod/
    ├── kustomization.yaml          # References base + applies prod patches
    ├── backend-configmap-prod.yaml
    ├── backend-ingress-patch.yaml  # Injects real hostname, TLS, security
    ├── web-ingress-patch.yaml      # Injects real hostname, TLS
    ├── backend-service-clusterip.yaml
    ├── web-service-clusterip.yaml
    └── dealbot-secrets.env         # SOPS-encrypted
```

## Example patches for production

### ClusterIP Service (backend)

```yaml
# backend-service-clusterip.yaml
apiVersion: v1
kind: Service
metadata:
  name: dealbot
spec:
  type: ClusterIP
  # ports and selectors inherited from base
```

### Ingress Patches

The infra repo patches the base Ingress resources to inject production values:

```yaml
# backend-ingress-patch.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dealbot-api
  annotations:
    # Inject TLS configuration
    cert-manager.io/cluster-issuer: letsencrypt-prod
    # Inject security policies
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/enable-cors: "true"
spec:
  # Inject IngressClass
  ingressClassName: nginx
  # Inject TLS configuration
  tls:
    - hosts:
        - api.dealbot.staging.filozone.io
      secretName: dealbot-api-tls
  rules:
    # Replace placeholder hostname with real one
    - host: api.dealbot.staging.filozone.io
      # Service routing inherited from base

# web-ingress-patch.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dealbot-web
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - dealbot.staging.filozone.io
      secretName: dealbot-web-tls
  rules:
    - host: dealbot.staging.filozone.io
```

### Production ConfigMap

```yaml
# backend-configmap-prod.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: dealbot-env
data:
  NODE_ENV: production
  DEALBOT_HOST: 0.0.0.0
  DEALBOT_PORT: "3130"
  DATABASE_HOST: postgres.database.svc.cluster.local
  DATABASE_PORT: "5432"
  DATABASE_USER: dealbot
  DATABASE_NAME: filecoin_dealbot
  NETWORK: mainnet
  DEAL_INTERVAL_SECONDS: "300"
  RETRIEVAL_INTERVAL_SECONDS: "600"
```

## Secrets management

Production secrets are managed via SOPS or External Secrets:

```bash
# Create unencrypted template
cat > /tmp/dealbot-secrets.env <<EOF
WALLET_PRIVATE_KEY=0x...
WALLET_ADDRESS=f1...
DATABASE_PASSWORD=...
EOF

# Encrypt with SOPS
cd filozone/infra/deployments/kubernetes/dealbot/staging
sops -e /tmp/dealbot-secrets.env > dealbot-secrets.env
rm /tmp/dealbot-secrets.env
```

Then reference in kustomization.yaml:

```yaml
secretGenerator:
  - name: dealbot-secrets
    envs:
      - dealbot-secrets.env
```

## Flux ImagePolicy for automatic updates

Flux watches the GitHub Container Registry for new image tags:

```yaml
# filozone/infra: flux/imagepolicies/dealbot-backend-staging.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: dealbot-backend-staging
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: dealbot-backend
  filterTags:
    pattern: '^sha-(?P<run>[0-9]+)-[0-9a-f]{40}$'
    extract: '$run'
  policy:
    numerical:
      order: asc
---
# filozone/infra: flux/imagerepositories/dealbot-backend.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: dealbot-backend
  namespace: flux-system
spec:
  image: ghcr.io/filozone/dealbot-backend
  interval: 5m
```

For production, watch semver tags:

```yaml
# filozone/infra: flux/imagepolicies/dealbot-backend-prod.yaml
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: dealbot-backend-prod
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: dealbot-backend
  policy:
    semver:
      range: '>=0.1.0'
```

## Local Development Ports

- **Backend API**: http://localhost:8080 (NodePort 30081 → container 3130)
- **Web UI**: http://localhost:3000 (NodePort 30080 → container 80)
- **PostgreSQL**: localhost:5432 (within cluster only)
