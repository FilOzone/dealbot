# Build stage
FROM node:25-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm i -g pnpm@9

# Copy workspace configuration files from root
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./

# Copy backend app files
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/pnpm-lock.yaml ./apps/backend/
COPY apps/backend/tsconfig*.json ./apps/backend/
COPY apps/backend/nest-cli.json ./apps/backend/

# Install dependencies (this will install for the entire workspace)
RUN pnpm install --frozen-lockfile

# Copy backend source code
COPY apps/backend/src/ ./apps/backend/src/

# Build the backend application
RUN pnpm --filter dealbot-backend run build

# Runtime stage
FROM node:20-alpine AS runner

# Install required packages for health checks
RUN apk add --no-cache curl wget

# Install pnpm
RUN npm i -g pnpm@9

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy workspace configuration files
COPY --chown=nestjs:nodejs pnpm-workspace.yaml ./
COPY --chown=nestjs:nodejs pnpm-lock.yaml ./
COPY --chown=nestjs:nodejs package.json ./

# Copy backend package files
COPY --chown=nestjs:nodejs apps/backend/package.json ./apps/backend/
COPY --chown=nestjs:nodejs apps/backend/pnpm-lock.yaml ./apps/backend/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile --filter dealbot-backend && pnpm store prune

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/apps/backend/dist ./apps/backend/dist

# Switch to non-root user
USER nestjs

# Environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3130

# Start the application
WORKDIR /app/apps/backend
CMD ["pnpm", "run", "start:prod"]
