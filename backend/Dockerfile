# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install pnpm and dependencies
RUN npm i -g pnpm@9
RUN pnpm install

# Copy source code
COPY src/ ./src/

# Build the application
RUN pnpm run build

# Build web frontend
WORKDIR /app/web
COPY web/package*.json web/pnpm-lock.yaml ./
RUN pnpm install

COPY web/ ./
RUN pnpm run build

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

# Copy package files and install production dependencies only
COPY package*.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

# Copy built application from builder stage
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Copy built web frontend
COPY --from=builder --chown=nestjs:nodejs /app/web/dist ./web/dist

# Switch to non-root user
USER nestjs

# Environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3130

# Start the application
CMD ["node", "dist/main.js"]