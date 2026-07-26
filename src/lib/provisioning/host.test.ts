import { describe, expect, it } from "vitest";
import {
  CAESAR_LEGACY_HARDCODED,
  resolveProvisionHost,
} from "@/lib/provisioning/host";
import { CAESAR_SERVER_SEED, type Server } from "@/lib/servers/types";

describe("resolveProvisionHost (Caesar parity)", () => {
  it("matches Prompt-0 hardcoded Caesar values byte-for-byte", () => {
    const caesar: Server = {
      id: 1,
      ...CAESAR_SERVER_SEED,
    };
    const resolved = resolveProvisionHost(caesar);

    expect(resolved.fleetRepoRoot).toBe(CAESAR_LEGACY_HARDCODED.fleetRepoRoot);
    expect(resolved.deployRoot).toBe(CAESAR_LEGACY_HARDCODED.deployRoot);
    expect(resolved.composeFile).toBe(CAESAR_LEGACY_HARDCODED.composeFile);
    expect(resolved.composeCwd).toBe(CAESAR_LEGACY_HARDCODED.composeCwd);
    expect(resolved.caddyFile).toBe(CAESAR_LEGACY_HARDCODED.caddyFile);
    expect(resolved.assetsHostPath).toBe(CAESAR_LEGACY_HARDCODED.assetsHostPath);
    expect(resolved.provisionDbHost).toBe(CAESAR_LEGACY_HARDCODED.provisionDbHost);
    expect(resolved.provisionDbPort).toBe(CAESAR_LEGACY_HARDCODED.provisionDbPort);
    expect(resolved.publicIp).toBe(CAESAR_LEGACY_HARDCODED.publicIp);
    expect(resolved.containerMysqlHost).toBe(
      CAESAR_LEGACY_HARDCODED.containerMysqlHost,
    );

    // Snapshot of before → after for the report.
    expect({
      before: { ...CAESAR_LEGACY_HARDCODED },
      after: {
        fleetRepoRoot: resolved.fleetRepoRoot,
        deployRoot: resolved.deployRoot,
        composeFile: resolved.composeFile,
        composeCwd: resolved.composeCwd,
        caddyFile: resolved.caddyFile,
        assetsHostPath: resolved.assetsHostPath,
        provisionDbHost: resolved.provisionDbHost,
        provisionDbPort: resolved.provisionDbPort,
        publicIp: resolved.publicIp,
        containerMysqlHost: resolved.containerMysqlHost,
      },
    }).toEqual({
      before: { ...CAESAR_LEGACY_HARDCODED },
      after: { ...CAESAR_LEGACY_HARDCODED },
    });
  });
});
