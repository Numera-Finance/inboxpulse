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
COPY apps/notifications ./apps/notifications

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build packages
RUN pnpm --filter @crm/shared build
RUN pnpm --filter @crm/database build
RUN pnpm --filter @crm/clients build
RUN pnpm --filter @crm/notifications build

# Build notifications app
RUN pnpm --filter @crm/notifications-app build

# Stage 2: Production
FROM oven/bun:1-alpine

WORKDIR /app

# Install Node.js for pnpm compatibility
RUN apk add --no-cache nodejs

# Enable corepack for pnpm
RUN corepack enable

# Copy package files and install pnpm version from packageManager
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN corepack install
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/clients/package.json ./packages/clients/
COPY packages/notifications/package.json ./packages/notifications/
COPY apps/notifications/package.json ./apps/notifications/

# Install production dependencies only (--ignore-scripts avoids patch-package requirement)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/clients/dist ./packages/clients/dist
COPY --from=builder /app/packages/notifications/dist ./packages/notifications/dist
COPY --from=builder /app/apps/notifications/dist ./apps/notifications/dist

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 4004

# Start application
CMD ["bun", "apps/notifications/dist/index.js"]
