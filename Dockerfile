# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.18.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps apps
COPY packages packages
RUN pnpm install --frozen-lockfile
RUN NEXT_STANDALONE=1 pnpm --filter @muse/web build

FROM node:22.22.0-bookworm-slim AS runtime
ARG SOURCE_REVISION=local
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
