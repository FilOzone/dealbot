# Local Monitoring (Prometheus + Grafana)

This is for the local Kind cluster only. It installs **minimal** Prometheus + Grafana via Helm (no kube-prometheus-stack/Operator) and wires up:
- Prometheus scrape configs for dealbot + dealbot-worker
- A Grafana dashboard ConfigMap sourced from `grafana-dashboard.json`

## Prerequisites
- Kind cluster running with the local overlay (e.g. `make up`).
- Helm installed.

## Quick start (recommended)
```bash
make monitoring-up
```

To include monitoring during `make up`, use `MONITORING=1 make up`.

## Manual install (Helm)
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm upgrade --install prometheus prometheus-community/prometheus \
  -n monitoring --create-namespace \
  -f kustomize/overlays/local/monitoring/prometheus-values.yaml

helm upgrade --install grafana grafana/grafana \
  -n monitoring --create-namespace \
  -f kustomize/overlays/local/monitoring/grafana-values.yaml
```
Note: the Grafana datasource URL assumes the Prometheus release name is `prometheus`.

## Apply the local monitoring overlay
```bash
kubectl apply -k kustomize/overlays/local/monitoring
```

This creates a Grafana dashboard ConfigMap sourced from `grafana-dashboard.json`.

## Access Grafana
```bash
kubectl -n monitoring port-forward svc/grafana 3001:80
```
Then open http://localhost:3001.

Grafana credentials are stored in a Secret in the `monitoring` namespace. List secrets and read the admin password:
```bash
kubectl get secret -n monitoring | rg grafana
kubectl get secret -n monitoring <grafana-secret> -o jsonpath='{.data.admin-password}' | base64 --decode
```

## Access Prometheus (optional)
```bash
kubectl -n monitoring port-forward svc/prometheus-server 9091:9090
```
Then open http://localhost:9091 and check Targets.
Note: `9090` is reserved for the dealbot-worker metrics NodePort mapping in the Kind config.

## Dashboard notes
- The dashboard in `grafana-dashboard.json` references a datasource named `prometheus`.
- If your Grafana datasource is named differently, either rename it to `prometheus` or edit the dashboard JSON before import.
