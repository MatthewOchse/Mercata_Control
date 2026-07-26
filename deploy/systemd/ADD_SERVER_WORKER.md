# Add a new server’s provisioning worker

> **Full procedure:** see [`NEW_SERVER_RUNBOOK.md`](../../NEW_SERVER_RUNBOOK.md)
> (host prep, MySQL, Caddy, register Server, worker, smoke test, DNS).
> This file is the **worker-only** excerpt.

Each application box runs **one** host-scoped worker. Jobs carry
`target_server_id`; the worker only claims rows where that id equals its
`MERCATA_SERVER_ID`. Never run two workers with the same id.

## 1. Register the Server in Control

```bash
npm run register:server -- \
  --name brutus \
  --public-ip x.x.x.x \
  --db-host 127.0.0.1 \
  --db-port 3306 \
  --deploy-path /home/matthew/brutus/sites/web \
  --capacity 14
```

`deploy_path` = storefront **repo root** (has `package.json`), not only `deploy/`.

```sql
SELECT id, name, deploy_path, public_ip FROM servers WHERE name = 'brutus';
```

## 2. Control checkout on the box

Clone Mercata Control so `workers/provision-worker.ts` exists. Worker needs
`DATABASE_URL` to Control MySQL (Tailscale/tunnel to Caesar — do not expose
Control DB publicly) plus local Docker and the fleet repo at `deploy_path`.

## 3. `.env.worker` on that host

```bash
cp deploy/systemd/env.worker.example .env.worker
```

Required:

```bash
MERCATA_SERVER_ID=<id from step 1>   # THIS BOX ONLY
DATABASE_URL=mysql://…@…/mercata_control
ENCRYPTION_KEY=…                      # same key as Control admin
PROVISION_MYSQL_USER=…
PROVISION_MYSQL_PASSWORD=…
PROVISION_SECRETS_DIR=/var/lib/mercata/provision-secrets
```

Do **not** copy Caesar’s `MERCATA_SERVER_ID`.

## 4. systemd (preferred) or pm2

```bash
sudo cp deploy/systemd/mercata-provision-worker.service \
  /etc/systemd/system/mercata-provision-worker-brutus.service
# Adapt WorkingDirectory / User / EnvironmentFile
sudo systemctl daemon-reload
sudo systemctl enable --now mercata-provision-worker-brutus
journalctl -u mercata-provision-worker-brutus -f
```

Expect:

```text
[worker] started server=brutus (#N) … (only target_server_id=N)
```

## 5. Verify scoping

1. Enqueue a job targeted at **this** server → this worker claims it.
2. Enqueue a job targeted at **Caesar** → this worker ignores it.

```bash
npm run smoke:server -- --name brutus
```

## 6. Caesar

Caesar’s `.env.worker` must set `MERCATA_SERVER_ID=<caesar servers.id>`
(usually `1`). Migration `024` back-fills historical jobs to Caesar.
