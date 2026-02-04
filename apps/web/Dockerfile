# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Accept build-time ARGs for Vite (optional - provide default fallback)
ARG VITE_API_BASE_URL
ARG VITE_PLAUSIBLE_DATA_DOMAIN

# Install pnpm
RUN npm i -g pnpm@9

# Copy workspace configuration files from root
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./

# Copy web app files
COPY apps/web/package.json ./apps/web/
COPY apps/web/pnpm-lock.yaml ./apps/web/
COPY apps/web/tsconfig*.json ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/components.json ./apps/web/

# Install dependencies (this will install for the entire workspace)
RUN pnpm install --frozen-lockfile

# Copy web app source code
COPY apps/web/index.html ./apps/web/
COPY apps/web/public/ ./apps/web/public/
COPY apps/web/src/ ./apps/web/src/

# Build the web application with build-time env vars (if provided)
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_PLAUSIBLE_DATA_DOMAIN=${VITE_PLAUSIBLE_DATA_DOMAIN}
RUN pnpm --filter web run build

# Runtime stage - serve with Caddy
FROM caddy:2-alpine

# Backend upstream for the in-container /api reverse proxy.
# Override at runtime to match your backend Service DNS name.
ENV DEALBOT_API_UPSTREAM=dealbot:3130

# Plausible analytics domain for runtime-config.js (optional).
# Override at runtime to enable analytics without rebuilding.
ENV VITE_PLAUSIBLE_DATA_DOMAIN=

# Copy built static files from builder stage
COPY --from=builder /app/apps/web/dist /srv
COPY apps/web/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
RUN chmod +x /usr/bin/docker-entrypoint.sh

# Create Caddyfile for SPA routing
RUN printf '%s\n' \
    ':80 {' \
    '    root * /srv' \
    '    encode gzip' \
    '' \
    '    # /health returns JSON 200 only if built static assets are present (index.html exists).' \
    '' \
    '    handle /health {' \
    '        @static_ok file /index.html' \
    '        header Content-Type application/json' \
    '        respond @static_ok ''{"status":"ok"}'' 200' \
    '        respond ''{"status":"error","reason":"static-unavailable"}'' 503' \
    '    }' \
    '' \
    '    handle /metrics {' \
    '        reverse_proxy {$DEALBOT_API_UPSTREAM}' \
    '    }' \
    '' \
    '    handle /api* {' \
    '        reverse_proxy {$DEALBOT_API_UPSTREAM}' \
    '    }' \
    '' \
    '    handle {' \
    '        try_files {path} /index.html' \
    '        file_server' \
    '    }' \
    '}' > /etc/caddy/Caddyfile

# Expose port
EXPOSE 80

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
