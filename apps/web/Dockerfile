# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Accept build-time ARG for VITE_API_BASE_URL (optional - provides default fallback)
ARG VITE_API_BASE_URL

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

# Build the web application with build-time env var (if provided)
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter web run build

# Runtime stage - serve with Caddy
FROM caddy:2-alpine

# Copy built static files from builder stage
COPY --from=builder /app/apps/web/dist /srv

# Create Caddyfile for SPA routing
RUN printf '%s\n' \
    ':80 {' \
    '    root * /srv' \
    '    encode gzip' \
    '' \
    '    handle /health {' \
    '        respond "healthy" 200' \
    '    }' \
    '' \
    '    handle /config.json {' \
    '        header Cache-Control "no-store"' \
    '        file_server' \
    '    }' \
    '' \
    '    handle /api* {' \
    '        reverse_proxy dealbot:3130' \
    '    }' \
    '' \
    '    handle {' \
    '        try_files {path} /index.html' \
    '        file_server' \
    '    }' \
    '}' > /etc/caddy/Caddyfile

# Runtime-config: write /srv/config.json from environment variables on container start.
COPY apps/web/docker-entrypoint.sh /usr/bin/docker-entrypoint.sh
RUN chmod +x /usr/bin/docker-entrypoint.sh

# Expose port
EXPOSE 80

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
