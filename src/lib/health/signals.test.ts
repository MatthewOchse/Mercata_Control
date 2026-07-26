import { describe, expect, it } from "vitest";
import { evaluateSignals } from "./signals";
import type { PollResult } from "./types";

function poll(partial: Partial<PollResult>): PollResult {
  return {
    tenantId: 1,
    slug: "crafties",
    planCode: "retail",
    ok: true,
    latencyMs: 100,
    certDaysRemaining: 60,
    httpsOk: true,
    fleetOk: true,
    payload: {
      contract: 1,
      status: "ok",
      db: { reachable: true, pending_migrations: 0 },
      storefront: { last_order_at: new Date().toISOString() },
    },
    error: null,
    ...partial,
  };
}

describe("health signal evaluation", () => {
  it("site_down after 2 consecutive failures", () => {
    const current = poll({ ok: false, error: "down" });
    const recent = [
      {
        ok: false,
        latency_ms: 5000,
        payload: null,
        checked_at: new Date().toISOString(),
      },
    ];
    const signals = evaluateSignals(current, recent);
    expect(signals.find((s) => s.signal === "site_down")?.active).toBe(true);
  });

  it("does not site_down on a single failure", () => {
    const current = poll({ ok: false });
    const signals = evaluateSignals(current, []);
    expect(signals.find((s) => s.signal === "site_down")?.active).toBe(false);
  });

  it("db_unreachable from payload", () => {
    const current = poll({
      fleetOk: true,
      payload: {
        status: "degraded",
        db: { reachable: false, pending_migrations: 0 },
      },
    });
    expect(
      evaluateSignals(current, []).find((s) => s.signal === "db_unreachable")
        ?.active,
    ).toBe(true);
  });

  it("cert_expiring under 14 days", () => {
    const current = poll({ certDaysRemaining: 10 });
    expect(
      evaluateSignals(current, []).find((s) => s.signal === "cert_expiring")
        ?.active,
    ).toBe(true);
  });

  it("slow across 3 consecutive polls > 3s", () => {
    const current = poll({ latencyMs: 4000 });
    const recent = [
      {
        ok: true,
        latency_ms: 3500,
        payload: null,
        checked_at: new Date().toISOString(),
      },
      {
        ok: true,
        latency_ms: 3200,
        payload: null,
        checked_at: new Date().toISOString(),
      },
    ];
    expect(
      evaluateSignals(current, recent).find((s) => s.signal === "slow")?.active,
    ).toBe(true);
  });

  it("pending_migrations when non-zero", () => {
    const current = poll({
      payload: {
        status: "ok",
        db: { reachable: true, pending_migrations: 2 },
      },
    });
    expect(
      evaluateSignals(current, []).find((s) => s.signal === "pending_migrations")
        ?.active,
    ).toBe(true);
  });

  it("sales_silence only with active baseline", () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const silent = poll({
      payload: {
        status: "ok",
        db: { reachable: true, pending_migrations: 0 },
        storefront: { last_order_at: eightDaysAgo },
      },
    });

    // No baseline → no alert
    expect(
      evaluateSignals(silent, []).find((s) => s.signal === "sales_silence")
        ?.active,
    ).toBe(false);

    // Baseline of fresh orders → alert
    // Check was 3 days ago; last order was 4 days ago (1 day old at check time).
    const recent = [
      {
        ok: true,
        latency_ms: 100,
        payload: {
          storefront: {
            last_order_at: new Date(
              Date.now() - 4 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        },
        checked_at: new Date(
          Date.now() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    ];
    expect(
      evaluateSignals(silent, recent).find((s) => s.signal === "sales_silence")
        ?.active,
    ).toBe(true);
  });

  it("skips sales_silence for service_hosting even with stale last_order_at", () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const current = poll({
      planCode: "service_hosting",
      payload: {
        status: "ok",
        db: { reachable: true, pending_migrations: 0 },
        storefront: { last_order_at: eightDaysAgo },
      },
    });
    const recent = [
      {
        ok: true,
        latency_ms: 100,
        payload: {
          storefront: {
            last_order_at: new Date(
              Date.now() - 4 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        },
        checked_at: new Date(
          Date.now() - 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    ];
    expect(
      evaluateSignals(current, recent).find((s) => s.signal === "sales_silence")
        ?.active,
    ).toBe(false);
  });
});
