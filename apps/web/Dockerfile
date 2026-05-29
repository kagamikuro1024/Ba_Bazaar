FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY pnpm-lock.yaml* ./

RUN pnpm install --filter @ba-bazaar/web... --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/shared packages/shared

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm --filter @ba-bazaar/web build

FROM caddy:2-alpine AS runtime

WORKDIR /srv
COPY --from=build /app/apps/web/dist /srv
COPY apps/web/Caddyfile /etc/caddy/Caddyfile

EXPOSE 3000
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
