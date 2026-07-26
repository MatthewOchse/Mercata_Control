# New server runbook

Repeatable procedure to bring a **new application host** online so tenants can be
provisioned onto it. Matches Caesar’s model: **each server is self-contained**
(own Docker, own fleet Caddy, own MySQL for tenant DBs). Control Plane stays
central; each box runs a **host-scoped** provision worker.

| Concept | Where it lives |
|---------|----------------|
| Server registry | Control DB `servers` row (`name`, `public_ip`, `db_host`, `db_port`, `deploy_path`, `capacity`) |
| Tenant placement | `tenants.server_id` + job `target_server_id` |
| Worker | One process per box: `MERCATA_SERVER_ID=<servers.id>` |
| Tenant DBs | MySQL **on that box** (not shared with other app servers) |
| Edge TLS | Fleet Caddy **on that box** (`:80` / `:443`) |

Related: `deploy/systemd/ADD_SERVER_WORKER.md` (worker-only excerpt).

---

## 0. Naming and addresses

Pick before you start:

| Item | Example | Notes |
|------|---------|--------|
| Server `name` | `brutus` | Lowercase; matches `tenant_infra.host` |
| Public IP | `x.x.x.x` | DNS A/AAAA for tenants on this box |
| SSH / Tailscale | reachable from your laptop + from Caesar if Control DB stays there | |
| Linux user | `matthew` | Owns checkouts and systemd unit |
| Layout root | `/home/matthew/brutus` | Parallel to Caesar’s `/home/matthew/caesar` |

**Deploy path (important):** `servers.deploy_path` must be the **storefront repo root**
(where `package.json` has `tenant:provision` / `fleet:generate`), **not** only the
generated `deploy/` folder.

Provision code resolves:

```text
fleetRepoRoot  = deploy_path
deployRoot     = {deploy_path}/deploy
composeFile    = {deploy_path}/deploy/docker-compose.fleet.yml
caddyFile      = {deploy_path}/deploy/Caddyfile
```

On Caesar today the live compose may also be copied/synced under
`~/caesar/fleet`; for a **new** box prefer the single tree below and set
`deploy_path` to that repo root.

---

## 1. Host prep

### 1.1 OS packages

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git curl openssl mysql-client
sudo usermod -aG docker "$USER"   # re-login after
node -v   # Node 20+ (install via nodesource/nvm if needed)
```

### 1.2 Directory layout

```bash
BOX=brutus
ROOT=/home/matthew/$BOX
mkdir -p "$ROOT"/{sites,control}
# Storefront (fleet tooling + deploy artifacts)
git clone <storefront-repo-url> "$ROOT/sites/web"
# Control (worker only — full admin UI can stay on Caesar)
git clone <control-repo-url> "$ROOT/control"
```

Expected after clone:

```text
$ROOT/sites/web/package.json
$ROOT/sites/web/deploy/          # created/updated by fleet:generate
$ROOT/control/workers/provision-worker.ts
```

### 1.3 Per-host MySQL (self-contained, Caesar-style)

Caesar runs MySQL on the host (Docker `crafties-dev-mysql` published on
**3306**). Tenant containers reach it via `host.docker.internal`. The provision
worker on the host uses `127.0.0.1:3306`.

On the new box, start the same pattern:

```bash
# From Control repo helpers (or copy the file)
cd "$ROOT/control"
sudo mkdir -p /var/lib/mercata/mysql
docker compose -f deploy/host-mysql.compose.yml --env-file deploy/host-mysql.env up -d
```

Template files (in this repo):

- `deploy/host-mysql.compose.yml`
- `deploy/host-mysql.env.example` → copy to `deploy/host-mysql.env` (not committed)

Smoke:

```bash
mysql -h127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT 1"
```

**Server row values for this model:**

| Field | Value |
|-------|--------|
| `db_host` | `127.0.0.1` |
| `db_port` | `3306` |

Tenant `.env` `MYSQL_HOST` remains `host.docker.internal` (Docker bridge) —
that is **not** the Server `db_host`.

Do **not** point this box’s tenants at Caesar’s MySQL. Each server owns its DBs.

### 1.4 Storefront image + fleet bootstrap

```bash
cd "$ROOT/sites/web"
cp .env.example .env.local   # or merge known keys; platform MySQL if used
npm ci
docker build -t mercata-storefront:latest -t crafties-nextjs:latest .

# Platform registry (if this fleet uses it) — same as Caesar
# npm run platform:init   # only if required for first boot on this box
```

Generate empty fleet skeleton (Caddy + compose):

```bash
npm run fleet:generate
# Artifacts under deploy/docker-compose.fleet.yml + deploy/Caddyfile
docker compose -f deploy/docker-compose.fleet.yml up -d caddy
```

Caddy must publish **80/443** on the public interface (same as Caesar’s
`fleet-caddy`). Open firewall/security group for 80/443 only as needed; do not
expose MySQL publicly (bind `127.0.0.1:3306` or Tailscale-only if you change the
compose ports).

### 1.5 Network / ports checklist

| Port | Service | Binding |
|------|---------|---------|
| 80, 443 | Fleet Caddy | Public (tenant domains) |
| 3306 | Host MySQL | `127.0.0.1` preferred |
| — | Control MySQL | **Not** on this box unless you co-locate Control; worker reaches Control via `DATABASE_URL` (Tailscale / SSH tunnel to Caesar) |

Worker → Control DB: use Tailscale IP of Caesar’s published Control MySQL, or an
SSH tunnel. Do not publish Control MySQL on the public internet.

### 1.6 Secrets dir

```bash
sudo mkdir -p /var/lib/mercata/provision-secrets
sudo chown "$USER:$USER" /var/lib/mercata/provision-secrets
chmod 700 /var/lib/mercata/provision-secrets
```

---

## 2. Register the Server in Control

From a machine with Control `DATABASE_URL` (laptop or Caesar):

```bash
cd /path/to/Mercata\ Control
npm run register:server -- \
  --name brutus \
  --label "Application host 2" \
  --public-ip x.x.x.x \
  --db-host 127.0.0.1 \
  --db-port 3306 \
  --deploy-path /home/matthew/brutus/sites/web \
  --capacity 14 \
  --active 1
```

Or Admin UI → **Servers** → register the same fields.

Record the id:

```bash
npm run register:server -- --name brutus --print-id
# → MERCATA_SERVER_ID=N
```

Mark **active** only when host prep (Docker, MySQL, Caddy, deploy path) is done.

---

## 3. Start the host-scoped worker

On the **new** box:

```bash
cd "$ROOT/control"
cp deploy/systemd/env.worker.example .env.worker
# Edit:
#   MERCATA_SERVER_ID=<id from step 2>     # THIS BOX ONLY
#   DATABASE_URL=…                         # Control DB (via Tailscale/tunnel)
#   ENCRYPTION_KEY=…                       # same as Control admin
#   PROVISION_MYSQL_USER=root
#   PROVISION_MYSQL_PASSWORD=…
#   PROVISION_SECRETS_DIR=/var/lib/mercata/provision-secrets
npm ci
```

Install systemd (adapt paths/user):

```bash
sudo cp deploy/systemd/mercata-provision-worker.service \
  /etc/systemd/system/mercata-provision-worker-$BOX.service
# Edit WorkingDirectory, EnvironmentFile, User to this box
sudo systemctl daemon-reload
sudo systemctl enable --now mercata-provision-worker-$BOX
journalctl -u mercata-provision-worker-$BOX -f
```

Startup must show:

```text
[worker] started server=brutus (#N) … (only target_server_id=N)
```

**Never** copy Caesar’s `MERCATA_SERVER_ID` onto this box.

---

## 4. Smoke test

Use a throwaway slug (e.g. `smoketest`) that is not a reserved id
(`crafties`, `geist`, `demo-online`).

### 4.1 Preflight

```bash
# Registry checks (any machine with DATABASE_URL):
npm run smoke:server -- --name brutus

# Full path check — run the same command on the new box so deploy_path is local
```

Confirms: server row active, `deploy_path` / `public_ip` / `db_*` set, and
prints the expected `MERCATA_SERVER_ID`. A missing local `package.json` is a
**warning** when run off-box; on the target host it should resolve.

### 4.2 Queue a job targeted at the new server

In Admin → **New tenant**:

1. Identity: `smoketest`, domain `smoketest.<your-test-domain>`, tier online
2. **Target server:** choose **brutus** (manual), not AUTO
3. Admin password ≥ 12 chars
4. Queue provision

Or verify targeting in SQL after submit:

```sql
SELECT id, tenant_id, target_server_id, status
FROM provisioning_jobs
ORDER BY id DESC LIMIT 5;
```

### 4.3 Confirm worker pickup

On the new box:

```bash
journalctl -u mercata-provision-worker-$BOX -f
# Expect: claimed job … target_server_id=N
```

Caesar’s worker must **not** claim it.

### 4.4 Health

When status is `succeeded`:

- Job log shows DNS guidance → **this server’s** `public_ip`
- `https://smoketest.<domain>/api/health` (after DNS/hosts file) returns ok
- Optional: `docker compose -f deploy/docker-compose.fleet.yml ps`

Temporary DNS for the smoke domain: A record (or `/etc/hosts`) → new server
public IP.

### 4.5 Offboard the test tenant

1. **Containers / deploy on the box**

```bash
cd "$ROOT/sites/web"
docker compose -f deploy/docker-compose.fleet.yml stop smoketest
docker compose -f deploy/docker-compose.fleet.yml rm -f smoketest
rm -rf deploy/tenants/smoketest
# Regenerate Caddy without the smoke host:
npm run fleet:generate
docker compose -f deploy/docker-compose.fleet.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
```

2. **MySQL on the box**

```bash
mysql -h127.0.0.1 -uroot -p -e "DROP DATABASE IF EXISTS storedb_smoketest;"
# Also drop platform registry row if platform DB is used on this host
```

3. **Control CRM**

- Tenant page → Offboard (or mark offboarded), or delete prospect/smoke row
  if your ops allow
- Confirm `/servers` capacity no longer counts the smoke tenant as active

4. Remove the smoke DNS record.

---

## 5. DNS and Caddy notes (production tenants)

### 5.1 DNS

For each tenant on this server:

```text
A / AAAA  tenant.example.com  →  servers.public_ip   (this box)
```

Control’s success screen prints that IP from the **target Server** row — not
Caesar’s IP.

www vs apex: follow the same Caddy pattern as Caesar (often both hosts in the
site block). Point both records at this box’s public IP when both are used.

### 5.2 Caddy

- Source of truth: `{deploy_path}/deploy/Caddyfile` from `npm run fleet:generate`
- Fleet compose service `caddy` mounts that file
- After each successful provision, generate/reload runs on **this** host’s
  worker (not on Caesar)
- Do not put Tenant-on-Brutus hosts into Caesar’s Caddyfile

### 5.3 Certificates

Caddy on-host ACME (same as Caesar). Ensure:

- Port 80 reachable from the internet for HTTP-01 (or configure DNS-01)
- No second reverse proxy stealing `:80`/`:443` on this box unless it forwards
  correctly

### 5.4 Control admin vs tenant edge

`admin.mercata.co.za` stays on Caesar (Control). Tenant domains for this server
go to **this** host’s fleet Caddy only.

---

## 6. Capacity and AUTO assign

Once the server is **active** with capacity &gt; 0, Admin → New tenant → AUTO
may select it when it has the most free slots under ceiling.

If all servers are full, the form blocks (or requires force override) — that is
the signal to run this runbook again for the next box.

---

## 7. Checklist (copy/paste)

- [ ] Docker + Node 20+ installed; user in `docker` group  
- [ ] Storefront cloned; `deploy_path` = that repo root  
- [ ] Host MySQL up on `127.0.0.1:3306`; root creds for worker  
- [ ] `fleet:generate` + Caddy up on 80/443  
- [ ] Storefront image `mercata-storefront:latest` built  
- [ ] `servers` row registered (public IP, db host/port, deploy path, capacity, active)  
- [ ] `.env.worker` with correct `MERCATA_SERVER_ID`  
- [ ] systemd worker running; log shows host scope  
- [ ] Smoke job claimed only by this worker; health OK; DNS IP correct  
- [ ] Smoke tenant offboarded (compose, DB, CRM, DNS)  

---

## Helpers in this repo

| Script | Purpose |
|--------|---------|
| `npm run register:server -- …` | Upsert `servers` row; print id |
| `npm run smoke:server -- --name <name>` | Preflight checks before first real tenant |
| `deploy/host-mysql.compose.yml` | Per-host MySQL (Caesar-style) |
| `deploy/systemd/mercata-provision-worker.service` | Worker unit template |
| `deploy/systemd/env.worker.example` | Worker env template |
