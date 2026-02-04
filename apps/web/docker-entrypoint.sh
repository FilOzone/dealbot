#!/bin/sh
set -eu

RUNTIME_CONFIG_PATH="/srv/runtime-config.js"

escape_js() {
  printf "%s" "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

API_BASE_URL="${DEALBOT_API_BASE_URL:-${VITE_API_BASE_URL:-}}"
PLAUSIBLE_DATA_DOMAIN="${VITE_PLAUSIBLE_DATA_DOMAIN:-}"

API_BASE_URL_ESCAPED="$(escape_js "$API_BASE_URL")"
PLAUSIBLE_DATA_DOMAIN_ESCAPED="$(escape_js "$PLAUSIBLE_DATA_DOMAIN")"

cat > "$RUNTIME_CONFIG_PATH" <<EOF
window.__DEALBOT_CONFIG__ = {
  API_BASE_URL: "${API_BASE_URL_ESCAPED}",
  PLAUSIBLE_DATA_DOMAIN: "${PLAUSIBLE_DATA_DOMAIN_ESCAPED}"
};
EOF

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
