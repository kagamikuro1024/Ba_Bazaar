# BA Bazaar - VPS Deployment (Docker Compose)

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

## 14) Add domain + HTTPS (Caddy)

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
