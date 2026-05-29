import { defineConfig } from 'prisma/config';

const localDevDatabaseUrl =
  'postgresql://ba_bazaar:change_me@localhost:5432/ba_bazaar?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: process.env.DATABASE_URL ?? localDevDatabaseUrl
  }
});
