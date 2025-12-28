# Multi-stage build for smaller image size

# Stage 1: Build
FROM node:22-alpine AS builder

# Enable corepack for pnpm (uses version from packageManager in package.json)
RUN corepack enable

WORKDIR /app

# Copy workspace files and install pnpm version from packageManager
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
RUN corepack install
COPY packages ./packages
COPY apps/web ./apps/web

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build packages that web depends on
RUN pnpm --filter @crm/shared build
RUN pnpm --filter @crm/clients build

# Build web app
RUN pnpm --filter @crm/web build

# Stage 2: Production - Serve with nginx
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script (generates runtime config from env vars)
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080 || exit 1

# Start with entrypoint (generates config.js from VITE_API_URL env var)
CMD ["/docker-entrypoint.sh"]
