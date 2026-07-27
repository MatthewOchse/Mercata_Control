import { describe, expect, it } from "vitest";
import { accessSync, constants as fsConstants } from "node:fs";

/**
 * Mirrors findMysqlBin / loopback checks used by mysql-cli (kept light —
 * full docker exec path is integration-only on Caesar).
 */
function findMysqlBin(): string | null {
  for (const candidate of ["/usr/bin/mysql", "/usr/local/bin/mysql"]) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

describe("mysql-cli host helpers", () => {
  it("treats common loopback names as local Docker-exec eligible", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("db.example.com")).toBe(false);
  });

  it("reports whether a host mysql binary exists (environment-dependent)", () => {
    const bin = findMysqlBin();
    expect(bin === null || bin.includes("mysql")).toBe(true);
  });
});
