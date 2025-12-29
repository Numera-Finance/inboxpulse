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
COPY apps/api ./apps/api

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build packages
RUN pnpm --filter @crm/cloud-google build
RUN pnpm --filter @crm/shared build
RUN pnpm --filter @crm/database build
RUN pnpm --filter @crm/clients build

# Build api app
RUN pnpm --filter @crm/api build

# Deploy the app with all dependencies bundled
RUN pnpm --filter @crm/api deploy --prod /deploy

# Stage 2: Production
FROM oven/bun:1-alpine

WORKDIR /app

# Copy deployed app (includes all dependencies properly bundled)
COPY --from=builder /deploy ./

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 4001

# Start application
CMD ["bun", "dist/index.js"]
