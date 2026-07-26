# Mercata Control Plane (`mercata-admin`)

Internal single-operator admin console for Mercata tenants, billing, and fleet health.

- **Local repo:** `~/Desktop/WebHosting/Mercata Control`
- **Server deploy path (later):** `~/caesar/control` on caesar → **admin.mercata.co.za** (behind shared Caddy)

There is **no public signup** and **no customer-facing login**.

## Locked decisions

| Decision | Setting | Why |
|---|---|---|
| VAT registered? | `VAT_REGISTERED=false` (change if/when you register) | If false, invoices show no VAT line and must not use the words "Tax Invoice". If true, they need your VAT number, 15% line, and the title "Tax Invoice". |
| Billing timing | In advance; signup month invoiced on Activate; default billing day **1** (editable 1–28) | Full month for signup month (no pro-rata). Due date follows billing day. |
| Mid-cycle plan changes | No pro-rata. Changes take effect on the next cycle. | Pro-rata arithmetic is a bug farm. Revisit at ~20 tenants. |

## Invoice invariants

1. Issued / paid / overdue / void invoices are **immutable** (no edit, no delete). Permitted transitions only: `issued → paid|overdue|void`, `overdue → paid|void`. Corrections: credit note (`CN-YYYY-NNNN`) then a fresh invoice.
2. Numbers are gap-free per year (`MER-2026-0001`), allocated at **issue** time with `SELECT … FOR UPDATE` on `number_sequences`. Voided invoices keep their number forever.
3. PDFs are written once to `storage/invoices/{year}/{number}.pdf` and never regenerated.
4. `VAT_REGISTERED=false` → title **"Invoice"**, no VAT line. `true` → **"Tax Invoice"** + 15% VAT.

Run invariant tests: `npm test`

## Fleet health

- Cron poll: `GET /api/cron/health-poll` every 3 min (`Authorization: Bearer $CRON_SECRET`)
- Warning digest: `GET /api/cron/alert-digest` at 08:00 SAST (06:00 UTC)
- See `crontab.example`
- Alerts: state-change only, 6h cooldown, maintenance silence, Resend + webhook channels
- Dashboard: `/health`

## Billing ops

- Issue emails PDF via Resend from `billings@mercata.co.za` (`INVOICE_EMAIL_FROM`); failures leave `sent_at` null and surface on the dashboard.
- Payments: allocate to invoice or leave unallocated; auto-paid when allocations cover total.
- Dunning: `GET /api/cron/dunning` daily 08:00 SAST — reminders logged once per stage; +21 days creates a manual suspension task (never auto-suspends).
- Bank CSV import: stub only (`lib/payments/bank-import.ts`).

## Customer analytics digests

- Per-tenant cadence: `digest_cadence` (`daily`|`weekly`|`off`, default **weekly**) + `digest_day` (1=Mon…7=Sun).
- Cron: `GET /api/cron/digests` at **07:00 SAST** (05:00 UTC). Weekly digests send on `digest_day`.
- Sales from fleet `/api/_fleet/stats` (source of truth). Optional GA4 via `ga4_property_id` + `GOOGLE_SERVICE_ACCOUNT_JSON` — traffic section omitted on failure/missing config.
- Preview: `/tenants/[slug]/digest/preview`. Settings on the tenant **Digest** tab.
- Unsubscribe link sets `digest_cadence = 'off'`. WhatsApp: consent columns only (`whatsapp_opt_in`, `whatsapp_number`) — adapter not implemented.

## Production (caesar)

Path: `~/caesar/control`. Compose services `mercata_admin` + `mercata_control_db` (dedicated MySQL, internal network only). App also joins external `caddy_net`; Caddy serves `admin.mercata.co.za` → `mercata_admin:3000`. **No host ports.**

- Deploy: `scripts/deploy-control.sh`
- Nightly backup: `scripts/backup-control.sh` → `/mnt/vault/backups/control/` (30 days)
- Restore: `scripts/restore-control.sh` (drill: `scripts/test-restore-control.sh`)
- Login: TOTP required; 5 failed attempts → 15 min lockout; `/login` rate-limited
- `audit_log`: app DB user has SELECT+INSERT only (no UPDATE/DELETE)

DNS (Xneelo): single A record `admin` → `165.49.25.59`. Do not change MX.


## Stack

- Next.js 15 (App Router, TypeScript)
- MySQL 8 via `DATABASE_URL`
- Migrations in `migrations/NNN_name.sql` with `schema_migrations` (fleet convention)
- Auth: email + password (argon2id) + mandatory TOTP; sessions in httpOnly cookies
- Design: Karoo Gold palette tokens on `[data-palette="karoo-gold"]` → Tailwind theme

## Setup

```bash
cp .env.example .env.local
# Edit DATABASE_URL, SESSION_SECRET, VAT_REGISTERED, etc.

npm install
npm run db:migrate

OPERATOR_EMAIL=you@mercata.co.za OPERATOR_PASSWORD='choose-a-long-password' \
  npm run seed:operator
# Scan the QR / otpauth URI, then:
OPERATOR_EMAIL=you@mercata.co.za OPERATOR_PASSWORD='…' CONFIRM_TOTP=1 \
  npm run seed:operator

npm run dev
```

Open http://localhost:3000 — you will be redirected to `/login`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run db:migrate` | Apply pending `migrations/*.sql` |
| `npm run seed:tenants` | Idempotent seed for crafties + geist (active) |

## Provisioning worker (host-scoped)

Each application box runs one worker with `MERCATA_SERVER_ID=<servers.id>`.
It only claims jobs where `provisioning_jobs.target_server_id` matches.

- **New host end-to-end:** [`NEW_SERVER_RUNBOOK.md`](./NEW_SERVER_RUNBOOK.md)
- Caesar unit: `deploy/systemd/mercata-provision-worker.service`
- Env template: `deploy/systemd/env.worker.example` (set `MERCATA_SERVER_ID`)
- Worker-only notes: `deploy/systemd/ADD_SERVER_WORKER.md`
- Helpers: `npm run register:server`, `npm run smoke:server`

## Design surfaces

| Surface | Audience | Treatment |
|---|---|---|
| Admin console | You | Quiet, utilitarian, high-density (IBM Plex Sans / Mono) |
| Invoice PDF | Customers | Full brand; Spectral; arch mark once under the total |
| Digest email | Customers | Tenant brand leads; Mercata in the footer only |

Gold (`--accent` / `--accent-strong`) is for money and primary action — never status.
Status always uses the status ramp **plus** icon **plus** label.
