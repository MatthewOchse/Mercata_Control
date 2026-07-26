import { describe, expect, it } from "vitest";
import {
  pickAutoTargetServer,
  resolveTargetServerSelection,
  type ServerFillOption,
} from "@/lib/servers/assign";

function opt(
  partial: Partial<ServerFillOption> & Pick<ServerFillOption, "id" | "name">,
): ServerFillOption {
  const capacity = partial.capacity ?? 14;
  const tenantCount = partial.tenantCount ?? 0;
  return {
    label: null,
    publicIp: "1.2.3.4",
    capacity,
    tenantCount,
    remaining: Math.max(0, capacity - tenantCount),
    active: true,
    ...partial,
  };
}

describe("pickAutoTargetServer", () => {
  it("picks the active server with the most free slots under capacity", () => {
    const picked = pickAutoTargetServer([
      opt({ id: 1, name: "caesar", tenantCount: 10, capacity: 14 }),
      opt({ id: 2, name: "brutus", tenantCount: 2, capacity: 14 }),
      opt({ id: 3, name: "retired", tenantCount: 0, capacity: 14, active: false }),
    ]);
    expect(picked?.name).toBe("brutus");
    expect(picked?.remaining).toBe(12);
  });

  it("returns null when all active servers are full", () => {
    expect(
      pickAutoTargetServer([
        opt({ id: 1, name: "caesar", tenantCount: 14, capacity: 14 }),
        opt({ id: 2, name: "brutus", tenantCount: 20, capacity: 14 }),
      ]),
    ).toBeNull();
  });
});

describe("resolveTargetServerSelection", () => {
  const servers = [
    opt({ id: 1, name: "caesar", tenantCount: 13, capacity: 14 }),
    opt({ id: 2, name: "brutus", tenantCount: 14, capacity: 14 }),
  ];

  it("auto picks under-capacity server", () => {
    const r = resolveTargetServerSelection({
      selection: "auto",
      servers,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("auto");
      expect(r.server.name).toBe("caesar");
    }
  });

  it("blocks when all full without force", () => {
    const r = resolveTargetServerSelection({
      selection: "auto",
      servers: [
        opt({ id: 1, name: "caesar", tenantCount: 14, capacity: 14 }),
        opt({ id: 2, name: "brutus", tenantCount: 14, capacity: 14 }),
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.allFull).toBe(true);
  });

  it("manual override of a full server requires force", () => {
    const blocked = resolveTargetServerSelection({
      selection: "2",
      servers,
    });
    expect(blocked.ok).toBe(false);

    const forced = resolveTargetServerSelection({
      selection: "2",
      servers,
      forceOverCapacity: true,
    });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.server.name).toBe("brutus");
  });
});
