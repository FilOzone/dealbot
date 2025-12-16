KIND_CLUSTER ?= dealbot-local
KIND_CONFIG ?= kind-config.yaml
NAMESPACE ?= dealbot

# Backend configuration
BACKEND_CHART_PATH ?= charts/dealbot
BACKEND_VALUES_LOCAL ?= $(BACKEND_CHART_PATH)/values.local.yaml
BACKEND_DEFAULT_VALUES_EXTRA := $(wildcard $(BACKEND_CHART_PATH)/values.local.override.yaml)
BACKEND_VALUES_EXTRA ?= $(BACKEND_DEFAULT_VALUES_EXTRA)
BACKEND_IMAGE_REPO ?= dealbot-local
BACKEND_IMAGE_TAG ?= dev

# Web configuration
WEB_CHART_PATH ?= charts/dealbot-web
WEB_VALUES_LOCAL ?= $(WEB_CHART_PATH)/values.local.yaml
WEB_DEFAULT_VALUES_EXTRA := $(wildcard $(WEB_CHART_PATH)/values.local.override.yaml)
WEB_VALUES_EXTRA ?= $(WEB_DEFAULT_VALUES_EXTRA)
WEB_IMAGE_REPO ?= dealbot-web-local
WEB_IMAGE_TAG ?= dev

HELM_ARGS ?=
SECRET_NAME ?= dealbot-secrets
SECRET_ENV_FILE ?= .env

.PHONY: kind-up kind-down namespace secret
.PHONY: backend-image-build backend-kind-load backend-deploy backend-undeploy backend-helm-lint backend-render backend-logs
.PHONY: web-image-build web-kind-load web-deploy web-undeploy web-helm-lint web-render web-logs
.PHONY: image-build kind-load deploy undeploy helm-lint render logs
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

backend-deploy:
	@if [ -n "$(SECRET_ENV_FILE)" ]; then \
		if [ ! -f "$(SECRET_ENV_FILE)" ]; then echo "SECRET_ENV_FILE $(SECRET_ENV_FILE) not found"; exit 1; fi; \
	else \
		if [ -z "$$WALLET_PRIVATE_KEY" ]; then echo "WALLET_PRIVATE_KEY env var is required (or set SECRET_ENV_FILE)"; exit 1; fi; \
		if [ -z "$$WALLET_ADDRESS" ]; then echo "WALLET_ADDRESS env var is required (or set SECRET_ENV_FILE)"; exit 1; fi; \
	fi
	$(MAKE) secret SECRET_ENV_FILE=$(SECRET_ENV_FILE)
	helm upgrade --install dealbot $(BACKEND_CHART_PATH) \
		--namespace $(NAMESPACE) \
		-f $(BACKEND_VALUES_LOCAL) $(if $(BACKEND_VALUES_EXTRA),-f $(BACKEND_VALUES_EXTRA)) \
		--set image.repository=$(BACKEND_IMAGE_REPO) \
		--set image.tag=$(BACKEND_IMAGE_TAG) \
		--set existingSecret=$(SECRET_NAME) \
		$(HELM_ARGS)

backend-undeploy:
	helm uninstall dealbot --namespace $(NAMESPACE)

backend-helm-lint:
	helm lint $(BACKEND_CHART_PATH) -f $(BACKEND_VALUES_LOCAL) $(if $(BACKEND_VALUES_EXTRA),-f $(BACKEND_VALUES_EXTRA)) $(HELM_ARGS)

backend-render:
	helm template dealbot $(BACKEND_CHART_PATH) -f $(BACKEND_VALUES_LOCAL) $(if $(BACKEND_VALUES_EXTRA),-f $(BACKEND_VALUES_EXTRA)) $(HELM_ARGS)

backend-logs:
	kubectl logs -n $(NAMESPACE) deploy/dealbot -f

# Web targets
web-image-build:
	docker build -f apps/web/Dockerfile -t $(WEB_IMAGE_REPO):$(WEB_IMAGE_TAG) .

web-kind-load:
	kind load docker-image $(WEB_IMAGE_REPO):$(WEB_IMAGE_TAG) --name $(KIND_CLUSTER)

web-deploy:
	helm upgrade --install dealbot-web $(WEB_CHART_PATH) \
		--namespace $(NAMESPACE) \
		-f $(WEB_VALUES_LOCAL) $(if $(WEB_VALUES_EXTRA),-f $(WEB_VALUES_EXTRA)) \
		--set image.repository=$(WEB_IMAGE_REPO) \
		--set image.tag=$(WEB_IMAGE_TAG) \
		$(HELM_ARGS)

web-undeploy:
	helm uninstall dealbot-web --namespace $(NAMESPACE)

web-helm-lint:
	helm lint $(WEB_CHART_PATH) -f $(WEB_VALUES_LOCAL) $(if $(WEB_VALUES_EXTRA),-f $(WEB_VALUES_EXTRA)) $(HELM_ARGS)

web-render:
	helm template dealbot-web $(WEB_CHART_PATH) -f $(WEB_VALUES_LOCAL) $(if $(WEB_VALUES_EXTRA),-f $(WEB_VALUES_EXTRA)) $(HELM_ARGS)

web-logs:
	kubectl logs -n $(NAMESPACE) deploy/dealbot-web -f

# Combined targets (build/deploy both backend and web)
image-build: backend-image-build web-image-build

kind-load: backend-kind-load web-kind-load

deploy: backend-deploy web-deploy

undeploy: backend-undeploy web-undeploy

helm-lint: backend-helm-lint web-helm-lint

render: backend-render web-render

logs:
	@echo "Use 'make backend-logs' or 'make web-logs'"

secret: namespace
	@if [ ! -f "$(SECRET_ENV_FILE)" ]; then echo "SECRET_ENV_FILE $(SECRET_ENV_FILE) not found"; exit 1; fi
	@tmp_env_file="$$(mktemp)"; \
		trap 'rm -f "$$tmp_env_file"' EXIT; \
		grep -E '^(WALLET_PRIVATE_KEY|WALLET_ADDRESS|DATABASE_PASSWORD|FILBEAM_BOT_TOKEN)=' "$(SECRET_ENV_FILE)" > "$$tmp_env_file" || true; \
		if ! grep -q '^WALLET_PRIVATE_KEY=' "$$tmp_env_file"; then echo "WALLET_PRIVATE_KEY is required (set in $(SECRET_ENV_FILE))"; exit 1; fi; \
		if ! grep -q '^WALLET_ADDRESS=' "$$tmp_env_file"; then echo "WALLET_ADDRESS is required (set in $(SECRET_ENV_FILE))"; exit 1; fi; \
		kubectl -n $(NAMESPACE) create secret generic $(SECRET_NAME) \
			--from-env-file="$$tmp_env_file" \
			--dry-run=client -o yaml | kubectl apply -f -

local-up:
	$(MAKE) image-build
	$(MAKE) kind-load
	$(MAKE) deploy

up:
	$(MAKE) kind-up
	$(MAKE) local-up

down:
	$(MAKE) undeploy || true
	$(MAKE) kind-down
