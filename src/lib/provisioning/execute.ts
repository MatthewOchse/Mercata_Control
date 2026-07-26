import type { ProvisioningJob } from "@/lib/provisioning/types";
import type { ProvisionHostTarget } from "@/lib/provisioning/host";
import { runProvisionRoutine } from "@/lib/provisioning/routine";

export type ProvisionStepContext = {
  job: ProvisioningJob;
  host: ProvisionHostTarget;
  log: (line: string) => Promise<void>;
};

export type ProvisionRunResult = {
  outcome: "succeeded" | "awaiting_env" | "failed";
  failedStep?: string;
  orphanNotes?: string;
};

/** Host-side provision entry used by the worker. */
export async function runProvisionSteps(
  ctx: ProvisionStepContext,
): Promise<ProvisionRunResult> {
  return runProvisionRoutine(ctx);
}
