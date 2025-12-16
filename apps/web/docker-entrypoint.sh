#!/bin/sh
set -eu

api_base_url="${VITE_API_BASE_URL:-}"

# Escape for a JSON string value (escape backslashes, double quotes, and newlines)
escaped_api_base_url="$(printf '%s' "$api_base_url" | tr -d '\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

# Write config.json with proper JSON format
cat > /srv/config.json <<EOF
{
  "VITE_API_BASE_URL": "$escaped_api_base_url"
}
EOF

exec "$@"
