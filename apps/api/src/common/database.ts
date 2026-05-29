export const LOCAL_DATABASE_URL =
  'postgresql://ba_bazaar:change_me@localhost:5432/ba_bazaar?schema=public';

export function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
}
