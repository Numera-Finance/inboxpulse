# Multi-stage build for smaller image size

# Stage 1: Build
FROM node:22-alpine AS builder

# Enable corepack for pnpm (uses version from packageManager in package.json)
RUN corepack enable

WORKDIR /app

# Copy workspace files and install pnpm version from packageManager
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
RUN corepack install

# Copy packages
COPY packages ./packages

# Copy analysis app
COPY apps/analysis ./apps/analysis

# Copy API package.json and source files for TypeScript path resolution
# (analysis service may need types from @crm/api)
COPY apps/api/package.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build packages (in order)
RUN pnpm --filter @crm/cloud-google build
RUN pnpm --filter @crm/shared build
RUN pnpm --filter @crm/database build
RUN pnpm --filter @crm/clients build

# Build analysis app
RUN pnpm --filter @crm/analysis build

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
COPY packages/cloud/google/package.json ./packages/cloud/google/
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/clients/package.json ./packages/clients/
COPY apps/analysis/package.json ./apps/analysis/

# Install production dependencies only (--ignore-scripts avoids patch-package requirement)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy built files from builder
COPY --from=builder /app/packages/cloud/google/dist ./packages/cloud/google/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/clients/dist ./packages/clients/dist
COPY --from=builder /app/apps/analysis/dist ./apps/analysis/dist

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 4003

# Start application
CMD ["bun", "apps/analysis/dist/index.js"]
