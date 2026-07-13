import { TopBar } from "@/components/layout/top-bar";
import {
  getDashboardMetrics,
  listOpenOperatorTasks,
  listUnsentInvoices,
} from "@/lib/dashboard/metrics";
import { DashboardClient } from "./home-dashboard";

export default async function HomePage() {
  const [metrics, unsent, tasks] = await Promise.all([
    getDashboardMetrics(),
    listUnsentInvoices(),
    listOpenOperatorTasks(),
  ]);

  return (
    <>
      <TopBar title="Dashboard" />
      <main className="p-5">
        <DashboardClient metrics={metrics} unsent={unsent} tasks={tasks} />
      </main>
    </>
  );
}
