FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY pnpm-lock.yaml* ./

RUN pnpm install --filter @ba-bazaar/api... --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared

RUN pnpm --filter @ba-bazaar/api db:generate
RUN pnpm --filter @ba-bazaar/api build

FROM node:22-alpine AS runtime

WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/api/prisma /app/apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts /app/apps/api/prisma.config.ts
COPY --from=build /app/packages/shared /app/packages/shared

EXPOSE 3001
CMD ["sh", "-c", "cd /app/apps/api && ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && exec node dist/main.js"]
