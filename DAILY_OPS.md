# Daily Ops Runbook (Backend)

This file is the daily operational checklist for the production backend.

Important:

- Do not commit real server IPs, SSH usernames, database credentials, or local machine paths to this file.
- Replace placeholder values below with environment-specific values at execution time.

## Scope

- Server project path: `<SERVER_PROJECT_PATH>`
- Public domain: `<API_DOMAIN>`
- API docs endpoint: `https://<API_DOMAIN>/api/docs`
- Main services (Docker Compose): `api`, `postgres`, `minio`

## 1) Update and deploy

Run on the server:

```bash
cd <SERVER_PROJECT_PATH>
git pull origin main
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Expected result:

- Services are `Up` (`api`, `postgres`, `minio`).
- No container is restarting in a loop.

## 2) Verify API health

```bash
curl -kI https://<API_DOMAIN>/api/docs
docker compose -f docker-compose.yml logs --tail=80 api
```

What to check:

- The docs endpoint responds (usually `HTTP 200`).
- API logs do not show startup errors (for example missing `DATABASE_URL`).

## 3) Verify DB and MinIO quickly

```bash
docker compose -f docker-compose.yml logs --tail=50 postgres
docker compose -f docker-compose.yml logs --tail=50 minio
```

What to check:

- PostgreSQL is accepting connections.
- MinIO starts cleanly and no auth/bucket errors appear.

## 4) Prisma commands

Run inside the `api` container:

```bash
docker compose -f docker-compose.yml exec api npx prisma generate
```

Schema apply options:

```bash
# Preferred in production if migrations exist
docker compose -f docker-compose.yml exec api npx prisma migrate deploy

# Use only when you explicitly need direct schema sync
docker compose -f docker-compose.yml exec api npx prisma db push
```

## 5) Restart only API (without touching DB/MinIO)

```bash
docker compose -f docker-compose.yml restart api
docker compose -f docker-compose.yml logs --tail=80 api
```

## 6) Domain/DNS checks

```bash
dig +short <API_DOMAIN>
dig +short <OPTIONAL_WWW_DOMAIN>
```

## 7) Prisma Studio from Mac (via SSH tunnel)

Terminal A (create tunnel):

```bash
ssh -N -L 6543:<POSTGRES_CONTAINER_IP>:5432 <SERVER_USER>@<SERVER_HOST>
```

If you need the container IP first, run on server:

```bash
cd <SERVER_PROJECT_PATH>
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  "$(docker compose -f docker-compose.yml ps -q postgres)"
```

Terminal B (run Prisma Studio locally):

```bash
cd <LOCAL_BACKEND_PROJECT_PATH>
export DATABASE_URL='postgresql://<DB_USER>:<DB_PASSWORD>@127.0.0.1:6543/<DB_NAME>?schema=public'
npx prisma studio --port 5560 --url="$DATABASE_URL"
```

Open: `http://127.0.0.1:5560`
