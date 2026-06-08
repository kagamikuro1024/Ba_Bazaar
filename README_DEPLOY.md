# BA Bazaar - Deployment

## Hugging Face Docker Space

Use this path when you only have a Hugging Face Space instead of a normal VPS.
The root `Dockerfile` builds the Vite frontend, builds the Nest API, starts a
PostgreSQL process inside the same container when no external `DATABASE_URL` is
provided, and exposes one public web server on port `7860`.

Important constraints:

- This is a Docker Space, not a traditional VPS.
- Hugging Face exposes one public app port. This repo uses `7860`.
- Runtime disk is ephemeral unless you attach persistent storage. Without
  persistent storage, embedded PostgreSQL data can disappear after restart/sleep.
- Do not put secrets in repo files. Add them in the Space Settings tab.

### 1) Create the Space

1. Create a new Hugging Face Space.
2. Select `Docker` as the SDK.
3. Keep the free CPU hardware if this is a demo/internal backup.
4. Open the Space repository URL.

The root `README.md` already includes the required Space metadata:

```yaml
sdk: docker
app_port: 7860
```

### 2) Add runtime settings

In Space `Settings` -> `Variables and secrets`, add at least:

```text
JWT_SECRET=<a long random string>
```

Optional variables:

```text
HF_AUTO_SEED=true
CORS_ORIGIN=https://your-custom-domain.example
```

`HF_AUTO_SEED=true` seeds demo data only when the `users` table is empty. The
embedded database path is `/data/postgres` when persistent storage is attached;
otherwise it falls back to `/home/user/pgdata`.

You usually do not need `CORS_ORIGIN` on the default Hugging Face domain because
the container derives it from `SPACE_HOST`. Set it manually when using a custom
domain.

Only set `DATABASE_URL` if you have an external PostgreSQL endpoint reachable
from Hugging Face. For a quick recovery/demo Space, leave `DATABASE_URL` empty so
the container starts its embedded PostgreSQL.

### 3) Push this repo to the Space

From your local repo:

```bash
git remote add hf https://huggingface.co/spaces/<YOUR_HF_USER>/<YOUR_SPACE_NAME>
git push hf HEAD:main
```

If the remote already exists:

```bash
git remote set-url hf https://huggingface.co/spaces/<YOUR_HF_USER>/<YOUR_SPACE_NAME>
git push hf HEAD:main
```

Hugging Face will rebuild automatically after the push. Watch the `Logs` panel in
the Space page.

### 4) Verify

Open:

```text
https://<YOUR_HF_USER>-<YOUR_SPACE_NAME>.hf.space/
```

Health check:

```text
https://<YOUR_HF_USER>-<YOUR_SPACE_NAME>.hf.space/health
```

Seeded demo accounts:

```text
manager@ba-bazaar.local / Manager@123
admin@ba-bazaar.local   / Admin@123
pm1@ba-bazaar.local     / Pmpo@123
ba1@ba-bazaar.local     / Ba@123
```

### 5) Redeploy

Commit your changes and push again:

```bash
git push hf HEAD:main
```

Every push rebuilds and restarts the Space. If you are using only the free
ephemeral disk, database changes made at runtime may be lost on restart.

## VPS Deployment (Docker Compose)

This guide deploys BA Bazaar on a VPS using Docker Compose, with Caddy as a reverse proxy.

## 1) SSH into VPS

```bash
ssh user@YOUR_VPS_IP
```

## 2) Detect OS

```bash
cat /etc/os-release
```

## 3) Install Docker + Compose plugin (Ubuntu 22.04/24.04 or Debian)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Optional: allow your user to run Docker without sudo:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## 4) Clone repo

```bash
git clone <YOUR_REPO_URL> ba-bazaar
cd ba-bazaar
```

## 5) Create .env.production

```bash
cp .env.production.example .env.production
nano .env.production
```

Update at least:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN` (use http://YOUR_VPS_IP first, then https://your-domain)
- `VITE_API_BASE_URL` (use http://YOUR_VPS_IP/api first, then https://your-domain/api)

## 6) Build + deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The API container runs `prisma migrate deploy` before starting, so pending database
migrations are applied during redeploy.

## 7) Check container status

```bash
docker ps
```

## 8) Check API health

```bash
curl http://localhost:3001/health
```

Or through proxy:

```bash
curl http://YOUR_VPS_IP/api/health
```

## 9) Check frontend

```bash
curl -I http://YOUR_VPS_IP
```

## 10) View logs

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200
```

If the API returns 500 after a merge that added Prisma migrations, check the API
startup log first:

```bash
docker compose -f docker-compose.prod.yml logs api --tail=200
```

## 11) Restart / redeploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## 12) Backup PostgreSQL

```bash
mkdir -p backups

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  > backups/ba-bazaar-$(date +%F).sql
```

## 13) Restore PostgreSQL (basic)

```bash
cat backups/ba-bazaar-YYYY-MM-DD.sql | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## 14) Seed production database

Only run this when you want to reset production to demo/seed data. The seed script
deletes existing users, BA profiles, projects, bookings, notifications, audit logs,
and related records before recreating sample data.

Back up first:

```bash
mkdir -p backups

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > backups/ba-bazaar-before-seed-$(date +%F-%H%M%S).sql
```

Make sure the latest migrations are applied:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Run seed inside the API container:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  sh -lc 'cd /app/apps/api && ./node_modules/.bin/tsx prisma/seed.ts'
```

Verify:

```bash
curl http://localhost:3001/health
docker compose -f docker-compose.prod.yml logs api --tail=100
```

## 15) Add domain + HTTPS (Caddy)

1. Point your domain A record to the VPS IP.
2. Edit Caddyfile:

```text
your-domain.com {
  encode gzip zstd

  handle_path /api/* {
    reverse_proxy api:3001
  }

  handle {
    reverse_proxy web:3000
  }
}
```

3. Reload Caddy:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy will automatically obtain and renew TLS certificates.
