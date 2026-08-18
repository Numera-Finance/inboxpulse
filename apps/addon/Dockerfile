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
COPY apps/addon ./apps/addon

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build workspace deps then the add-on
RUN pnpm --filter @crm/shared build
RUN pnpm --filter @crm/addon build

# Deploy the app with all dependencies bundled
RUN pnpm --filter @crm/addon deploy --prod /deploy

# Stage 2: Production
FROM oven/bun:1-alpine

WORKDIR /app

COPY --from=builder /deploy ./

ENV NODE_ENV=production

EXPOSE 4005

CMD ["bun", "dist/index.js"]
