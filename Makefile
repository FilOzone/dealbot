KIND_CLUSTER ?= dealbot-local
KIND_CONFIG ?= kind-config.yaml
NAMESPACE ?= dealbot

# Kustomize configuration
KUSTOMIZE_OVERLAY ?= kustomize/overlays/local

# Image configuration
BACKEND_IMAGE_REPO ?= dealbot-local
BACKEND_IMAGE_TAG ?= dev
WEB_IMAGE_REPO ?= dealbot-web-local
WEB_IMAGE_TAG ?= dev

SECRET_NAME ?= dealbot-secrets
SECRET_ENV_FILE ?= .env

# Local monitoring (Prometheus + Grafana)
MONITORING ?= 0
MONITORING_NAMESPACE ?= monitoring
MONITORING_OVERLAY ?= kustomize/overlays/local/monitoring
GRAFANA_RELEASE ?= grafana
PROM_VALUES ?= $(MONITORING_OVERLAY)/prometheus-values.yaml
GRAFANA_VALUES ?= $(MONITORING_OVERLAY)/grafana-values.yaml

.PHONY: kind-up kind-down namespace secret
.PHONY: backend-image-build backend-kind-load backend-logs
.PHONY: web-image-build web-kind-load web-logs
.PHONY: image-build kind-load deploy undeploy render logs
.PHONY: redeploy restart restart-backend restart-web
.PHONY: monitoring-install monitoring-apply monitoring-up monitoring-down
.PHONY: local-up up down

kind-up:
	kind create cluster --name $(KIND_CLUSTER) --config $(KIND_CONFIG)

kind-down:
	-kind delete cluster --name $(KIND_CLUSTER)

namespace:
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -

# Backend targets
backend-image-build:
	docker build -f apps/backend/Dockerfile -t $(BACKEND_IMAGE_REPO):$(BACKEND_IMAGE_TAG) .

backend-kind-load:
	kind load docker-image $(BACKEND_IMAGE_REPO):$(BACKEND_IMAGE_TAG) --name $(KIND_CLUSTER)

backend-logs:
	kubectl logs -n $(NAMESPACE) deploy/dealbot -f

# Web targets
web-image-build:
	docker build -f apps/web/Dockerfile -t $(WEB_IMAGE_REPO):$(WEB_IMAGE_TAG) .

web-kind-load:
	kind load docker-image $(WEB_IMAGE_REPO):$(WEB_IMAGE_TAG) --name $(KIND_CLUSTER)

web-logs:
	kubectl logs -n $(NAMESPACE) deploy/dealbot-web -f

# Combined targets
image-build: backend-image-build web-image-build

kind-load: backend-kind-load web-kind-load

deploy: secret
	kubectl apply -k $(KUSTOMIZE_OVERLAY)

undeploy:
	-kubectl delete -k $(KUSTOMIZE_OVERLAY)

render:
	kubectl kustomize $(KUSTOMIZE_OVERLAY)

monitoring-install:
	helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
	helm repo add grafana https://grafana.github.io/helm-charts
	helm repo update
	helm upgrade --install prometheus prometheus-community/prometheus \
		-n $(MONITORING_NAMESPACE) --create-namespace \
		-f $(PROM_VALUES)
	helm upgrade --install $(GRAFANA_RELEASE) grafana/grafana \
		-n $(MONITORING_NAMESPACE) --create-namespace \
		-f $(GRAFANA_VALUES)

monitoring-apply:
	kubectl apply -k $(MONITORING_OVERLAY)

monitoring-up: monitoring-install monitoring-apply

monitoring-down:
	-kubectl delete -k $(MONITORING_OVERLAY)
	-helm uninstall $(GRAFANA_RELEASE) -n $(MONITORING_NAMESPACE)
	-helm uninstall prometheus -n $(MONITORING_NAMESPACE)

logs:
	@echo "Use 'make backend-logs' or 'make web-logs'"

restart-backend:
	kubectl -n $(NAMESPACE) rollout restart deploy/dealbot
	kubectl -n $(NAMESPACE) rollout status deploy/dealbot

restart-web:
	kubectl -n $(NAMESPACE) rollout restart deploy/dealbot-web
	kubectl -n $(NAMESPACE) rollout status deploy/dealbot-web

restart: restart-backend restart-web

# Dev convenience: rebuild images, load into Kind, apply manifests, and restart pods.
# This avoids stale `:dev` images when imagePullPolicy is IfNotPresent.
redeploy:
	$(MAKE) image-build
	$(MAKE) kind-load
	$(MAKE) deploy
	$(MAKE) restart

secret: namespace
	@if [ ! -f "$(SECRET_ENV_FILE)" ]; then echo "SECRET_ENV_FILE $(SECRET_ENV_FILE) not found"; exit 1; fi
	@tmp_env_file="$$(mktemp)"; \
		trap 'rm -f "$$tmp_env_file"' EXIT; \
		grep -E '^(WALLET_PRIVATE_KEY|WALLET_ADDRESS|DATABASE_PASSWORD)=' "$(SECRET_ENV_FILE)" > "$$tmp_env_file" || true; \
		if ! grep -q '^WALLET_PRIVATE_KEY=' "$$tmp_env_file"; then echo "WALLET_PRIVATE_KEY is required (set in $(SECRET_ENV_FILE))"; exit 1; fi; \
		if ! grep -q '^WALLET_ADDRESS=' "$$tmp_env_file"; then echo "WALLET_ADDRESS is required (set in $(SECRET_ENV_FILE))"; exit 1; fi; \
		kubectl -n $(NAMESPACE) create secret generic $(SECRET_NAME) \
			--from-env-file="$$tmp_env_file" \
			--dry-run=client -o yaml | kubectl apply -f -

local-up:
	$(MAKE) image-build
	$(MAKE) kind-load
	$(MAKE) deploy
	@if [ "$(MONITORING)" = "1" ]; then $(MAKE) monitoring-up; fi

up:
	$(MAKE) kind-up
	$(MAKE) local-up

down:
	@if kind get clusters 2>/dev/null | grep -q "^$(KIND_CLUSTER)$$"; then \
		$(MAKE) undeploy || true; \
	fi
	$(MAKE) kind-down
