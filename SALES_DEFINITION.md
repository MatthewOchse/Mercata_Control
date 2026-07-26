# Sales definition (commission basis)

This is the authoritative definition of the sales figure Mercata charges
commission on. It is written to match contract wording, and the implementation
in `src/lib/sales/gross-sales.ts` follows it exactly.

## The figure

> **Gross sales** means the total value of all completed sale transactions
> recorded on the tenant's Mercata platform, dated within the calendar month,
> **before** deducting refunds, returns, or cancellations.

Commission is `gross sales × commission rate` (Starter: 2%). It is billed in
arrears for the month measured, alongside the base fee for the month ahead.

## What counts

Sales are read from the tenant's `stocktrn` transaction ledger. The transaction
type determines inclusion:

| Type | Meaning | Counts? |
|---|---|---|
| `OS` | Online / web order **or paid event booking** | Yes |
| `CS` | Cash sale at point of sale | Yes |
| `ZS` | Card sale at point of sale | Yes |
| `AS` | On-account sale | Yes |
| `RF` | Refund / return | **No** |
| `AP` | Payment against an account | **No** |

**All sales channels count.** Commission applies to the tenant's whole turnover
through the platform — in-store, online shop, and paid event bookings alike.
Paid bookings write an `OS` ledger row (sub_code `BOOKING`) and are therefore
already inside gross sales. The Commerce card and fleet stats also surface them
as a separate **Events** line so they are visible, not double-counted.

`AP` is excluded because settling an account is not a new sale — the underlying
`AS` was already counted. Counting both would double-charge.

`RF` is excluded because the basis is **gross**, not net. Refunds are visible
separately in the tenant's analytics but do not reduce the commission basis.

### Amount used per transaction

`tax_gross` where present, otherwise `total_price`. Both are VAT-inclusive
transaction totals in Rand. Absolute value is taken, so a negatively-signed row
cannot silently reduce the month.

### Draft, test, and unpaid orders

Excluded automatically, by construction rather than by filter. A web order only
produces an `OS` ledger row when payment is fulfilled, so pending, abandoned,
and failed orders never reach the ledger. There are no test-order markers to
filter — the ledger only contains real transactions.

## Period boundaries

Months are **Africa/Johannesburg (SAST) calendar months**. July 2026 runs from
`2026-07-01 00:00:00 SAST` up to but excluding `2026-08-01 00:00:00 SAST`.

SAST is UTC+2 year-round; South Africa does not observe daylight saving, so the
offset is exact and never drifts.

This matters because tenant ledgers store timestamps in UTC, and the fleet
statistics endpoint interprets a bare `YYYY-MM-DD` parameter as a *UTC* day.
Requesting `from=2026-07-01` would therefore start the month two hours early
and pull in transactions that belong to 30 June locally. The control plane
avoids this by sending explicit instants (`2026-06-30T22:00:00Z`), which the
endpoint uses verbatim.

## Currency

ZAR throughout. Money is handled as integer cents everywhere in this codebase;
`grossSalesCents` is cents, never a decimal or float.

## Where the figure comes from

A **closed** month's gross can never change, so a figure measured on the 1st is
as true as one measured on the 8th. That makes the following order safe, and it
is the order the code uses:

1. **Manual** — a figure an operator entered by hand. A human decision outranks
   any machine read, and a later live read must never silently overwrite it.
2. **Live** — `GET /api/_fleet/stats` on the tenant's own deployment,
   authenticated with the tenant's fleet secret.
3. **Already resolved** — the figure captured for this month by the monthly
   snapshot job, which runs on the 1st. This is what stops billing from breaking
   because a storefront happens to be down on billing day. Reported as `cached`.
4. **Warehouse** — `analytics_daily` in the control-plane database, populated
   nightly from the same endpoint. Used only when every day of the month is
   present. Because the nightly job buckets by UTC day, month edges may differ
   slightly from a live read.

An **open** month always reads live and never uses a cached figure, because the
figure is still moving.

The source is recorded on the invoice and shown in the billing run, so the
operator can always see whether a figure was measured live, captured earlier, or
entered by hand.

Every resolution attempt — success or failure — is written to
`tenant_sales_monthly`. An issued invoice can therefore always be re-explained:
the figure used, the source it came from, and when it was read.

## A zero is not the same as a failure

- **Genuine zero**: the tenant traded nothing that month. Returns
  `ok: true, grossSalesCents: 0`. Commission is legitimately R0.
- **Unreadable**: the deployment was unreachable, the secret was rejected, or
  the response was malformed. Returns `ok: false` with the error text.

An unreadable tenant **never** becomes a zero. The draft invoice is created in a
`needs attention` state with no commission line and cannot be approved until an
operator resolves it. A silent zero would under-bill the client and hide a
broken deployment, which is why this rule is enforced in code rather than left
to convention.

## Partial months

A month that has not yet ended in SAST returns `partial: true`. Commission is
only ever drafted from a closed month, and the billing run refuses to approve a
commission line built on a partial figure.
