FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages

RUN pnpm build

FROM golang:1.24-bookworm AS api-build

WORKDIR /app/apps/api

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/cmd ./cmd

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/ba-bazaar-api ./cmd/api

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_PORT=3001
ENV PUBLIC_PORT=7860
ENV WEB_DIST=/app/apps/web/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    postgresql-15 \
    postgresql-client-15 \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=1000:0 /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=1000:0 /app/node_modules node_modules
COPY --from=build --chown=1000:0 /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=1000:0 /app/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=1000:0 /app/apps/api/dist apps/api/dist
COPY --from=build --chown=1000:0 /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=1000:0 /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build --chown=1000:0 /app/apps/web/dist apps/web/dist
COPY --from=build --chown=1000:0 /app/packages/shared packages/shared
COPY --from=api-build --chown=1000:0 /out/ba-bazaar-api /app/ba-bazaar-api
COPY --chown=1000:0 scripts/hf-entrypoint.sh scripts/hf-entrypoint.sh
COPY --chown=1000:0 scripts/hf-web-server.mjs scripts/hf-web-server.mjs

RUN chmod +x /app/scripts/hf-entrypoint.sh \
  && mkdir -p /home/user/pgdata /home/user/postgres-socket \
  && chown -R 1000:0 /home/user /app

USER 1000

EXPOSE 7860

ENTRYPOINT ["tini", "--", "/app/scripts/hf-entrypoint.sh"]
