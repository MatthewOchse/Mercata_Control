import { Suspense } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { getFleetAnalyticsStrip } from "@/lib/analytics/queries";
import { listOpenGraduationFlags } from "@/lib/billing/graduation";
import { getLifecycleView } from "@/lib/dashboard/lifecycle";
import {
  getDashboardMetrics,
  listOpenOperatorTasks,
  listUnsentInvoices,
} from "@/lib/dashboard/metrics";
import { listTenants } from "@/lib/tenants/queries";
import { DashboardClient } from "./home-dashboard";

export default async function HomePage() {
  const [metrics, unsent, tasks, fleet, tenants, lifecycle, graduations] =
    await Promise.all([
      getDashboardMetrics(),
      listUnsentInvoices(),
      listOpenOperatorTasks(),
      getFleetAnalyticsStrip().catch(() => null),
      listTenants(),
      getLifecycleView(),
      listOpenGraduationFlags(),
    ]);

  const tenantOptions = tenants
    .filter((t) => t.status === "active" || t.status === "suspended")
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      tradingName: t.trading_name,
    }));

  return (
    <>
      <TopBar title="Dashboard" />
      <main className="p-5">
        <Suspense fallback={null}>
          <DashboardClient
            metrics={metrics}
            unsent={unsent}
            tasks={tasks}
            fleet={fleet}
            tenants={tenantOptions}
            lifecycle={lifecycle}
            graduations={graduations}
          />
        </Suspense>
      </main>
    </>
  );
}
