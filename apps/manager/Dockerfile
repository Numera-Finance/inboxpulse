# InboxPulse manager API.
#
# Unlike the other services this one is plain CommonJS with two runtime
# dependencies and no build step, so there is nothing to compile — the image is
# just node + node_modules + src. Kept as its own service (rather than folded
# into crm-api) because it is IAM-gated: crm-api is --allow-unauthenticated and
# guards itself at the application layer, while this one is reachable only by
# principals holding roles/run.invoker.

FROM node:22-alpine

WORKDIR /app

# Dependencies first so the layer caches across source-only changes.
# No lockfile is copied: this service is deliberately outside the pnpm
# workspace install for the image, and `npm install --omit=dev` over two
# pinned-range deps is deterministic enough for a service with no build.
COPY apps/manager/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY apps/manager/src ./src

ENV NODE_ENV=production

# Cloud Run injects PORT; the server already reads it (default 3000).
EXPOSE 8080
ENV PORT=8080

CMD ["node", "src/server.js"]
