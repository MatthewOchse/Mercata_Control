import { describe, expect, it } from "vitest";
import { platformTierForPlan } from "@/lib/plans/tier-map";

describe("platformTierForPlan", () => {
  it("maps retail plans to retail features", () => {
    expect(platformTierForPlan("retail")).toBe("retail");
    expect(platformTierForPlan("retail_pro")).toBe("retail");
  });

  it("maps starter/online/sites to online features", () => {
    expect(platformTierForPlan("starter")).toBe("online");
    expect(platformTierForPlan("online")).toBe("online");
    expect(platformTierForPlan("service_hosting")).toBe("online");
  });
});
