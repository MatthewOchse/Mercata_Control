/**
 * Pick which Server should receive a new provisioned tenant.
 * AUTO: active server with the most free slots that is still under capacity.
 */
export type ServerFillOption = {
  id: number;
  name: string;
  label: string | null;
  publicIp: string | null;
  capacity: number;
  tenantCount: number;
  remaining: number;
  active: boolean;
};

export type ResolveTargetServerInput = {
  /** "auto" or a numeric server id string */
  selection: string;
  servers: ServerFillOption[];
  /** When true, allow picking a full server (manual override). */
  forceOverCapacity?: boolean;
};

export type ResolveTargetServerResult =
  | { ok: true; server: ServerFillOption; mode: "auto" | "manual" }
  | { ok: false; error: string; allFull: boolean };

/** Active registered boxes with a positive ceiling, sorted by free capacity desc. */
export function activeProvisionCandidates(
  servers: ServerFillOption[],
): ServerFillOption[] {
  return servers
    .filter((s) => s.active && s.id > 0 && s.capacity > 0)
    .slice()
    .sort(
      (a, b) =>
        b.remaining - a.remaining || a.name.localeCompare(b.name),
    );
}

/**
 * AUTO: most free capacity among active servers still under their ceiling.
 * Returns null when every active server is at/over capacity (or none exist).
 */
export function pickAutoTargetServer(
  servers: ServerFillOption[],
): ServerFillOption | null {
  const under = activeProvisionCandidates(servers).filter(
    (s) => s.tenantCount < s.capacity,
  );
  return under[0] ?? null;
}

export function resolveTargetServerSelection(
  input: ResolveTargetServerInput,
): ResolveTargetServerResult {
  const candidates = activeProvisionCandidates(input.servers);
  if (candidates.length === 0) {
    return {
      ok: false,
      allFull: true,
      error:
        "No active servers with capacity are registered — add a server under /servers first",
    };
  }

  const selection = input.selection.trim().toLowerCase();
  const force = Boolean(input.forceOverCapacity);

  if (!selection || selection === "auto") {
    const picked = pickAutoTargetServer(input.servers);
    if (picked) {
      return { ok: true, server: picked, mode: "auto" };
    }
    if (!force) {
      return {
        ok: false,
        allFull: true,
        error:
          "All servers are at or over capacity. Provision a new box first, or choose a server and confirm force override.",
      };
    }
    // Forced AUTO when full: still pick the one with the most remaining
    // (least negative / most free among full boxes — remaining is clamped ≥0,
    // so prefer lowest tenantCount / capacity ratio).
    const fallback = candidates.slice().sort((a, b) => {
      const aOver = a.tenantCount - a.capacity;
      const bOver = b.tenantCount - b.capacity;
      return aOver - bOver || a.name.localeCompare(b.name);
    })[0]!;
    return { ok: true, server: fallback, mode: "auto" };
  }

  const id = Number(selection);
  if (!Number.isFinite(id) || id <= 0) {
    return {
      ok: false,
      allFull: false,
      error: "Invalid target server selection",
    };
  }

  const server = input.servers.find((s) => s.id === id);
  if (!server) {
    return {
      ok: false,
      allFull: false,
      error: `Server #${id} is not registered`,
    };
  }
  if (!server.active) {
    return {
      ok: false,
      allFull: false,
      error: `Server "${server.name}" is not active`,
    };
  }
  if (server.capacity <= 0) {
    return {
      ok: false,
      allFull: false,
      error: `Server "${server.name}" has no capacity ceiling — set one under /servers`,
    };
  }
  if (server.tenantCount >= server.capacity && !force) {
    return {
      ok: false,
      allFull: true,
      error: `Server "${server.name}" is at capacity (${server.tenantCount}/${server.capacity}). Confirm force override or provision a new box first.`,
    };
  }

  return { ok: true, server, mode: "manual" };
}
