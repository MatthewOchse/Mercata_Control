import type { ProvisioningTier } from "@/lib/provisioning/types";

/**
 * Map Control billing plan → storefront platform tier (feature set).
 * Platform only has online | retail; billing has starter / sites / etc.
 */
export function platformTierForPlan(planCode: string): ProvisioningTier {
  const code = planCode.trim().toLowerCase();
  if (code === "retail" || code === "retail_pro") return "retail";
  // starter, online, service_hosting, unknown → online feature set
  return "online";
}
