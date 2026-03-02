# Daily Ops Runbook (Backend)

This file is the daily operational checklist for the production backend.

## Scope

- Server project path: `/root/Back-end-budget-app`
- Public domain: `kevinlg.cloud`
- API docs endpoint: `https://kevinlg.cloud/api/docs`
- Main services (Docker Compose): `api`, `postgres`, `minio`

## 1) Update and deploy

Run on the server:

```bash
cd /root/Back-end-budget-app
git pull origin main
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Expected result:

- Services are `Up` (`api`, `postgres`, `minio`).
- No container is restarting in a loop.

## 2) Verify API health

```bash
curl -kI https://kevinlg.cloud/api/docs
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
dig +short kevinlg.cloud
dig +short www.kevinlg.cloud
```

Expected IP (current target): `187.124.76.128`

## 7) Prisma Studio from Mac (via SSH tunnel)

Terminal A (create tunnel):

```bash
ssh -N -L 6543:<POSTGRES_CONTAINER_IP>:5432 root@187.124.76.128
```

If you need the container IP first, run on server:

```bash
cd /root/Back-end-budget-app
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  "$(docker compose -f docker-compose.yml ps -q postgres)"
```

Terminal B (run Prisma Studio locally):

```bash
cd /Users/nightmare28899/Documents/projects/personal/budgetApp/Back-end-budget-app
export DATABASE_URL='postgresql://budget_user:budget_pass_change_me@127.0.0.1:6543/budget_app?schema=public'
npx prisma studio --port 5560 --url="$DATABASE_URL"
```

Open: `http://127.0.0.1:5560`
