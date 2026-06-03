import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: 'postgresql://ba_bazaar:change_me@localhost:5433/ba_bazaar?schema=public'
  }
});
