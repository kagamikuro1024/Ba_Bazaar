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

RUN useradd -m -u 1000 user

WORKDIR /app

COPY --from=build --chown=user:user /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=user:user /app/node_modules node_modules
COPY --from=build --chown=user:user /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=user:user /app/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=user:user /app/apps/api/dist apps/api/dist
COPY --from=build --chown=user:user /app/apps/api/prisma apps/api/prisma
COPY --from=build --chown=user:user /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build --chown=user:user /app/apps/web/dist apps/web/dist
COPY --from=build --chown=user:user /app/packages/shared packages/shared
COPY --chown=user:user scripts/hf-entrypoint.sh scripts/hf-entrypoint.sh
COPY --chown=user:user scripts/hf-web-server.mjs scripts/hf-web-server.mjs

RUN chmod +x /app/scripts/hf-entrypoint.sh \
  && mkdir -p /home/user/pgdata /home/user/postgres-socket \
  && chown -R user:user /home/user

USER user

EXPOSE 7860

ENTRYPOINT ["tini", "--", "/app/scripts/hf-entrypoint.sh"]
