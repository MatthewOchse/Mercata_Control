import { TopBar } from "@/components/layout/top-bar";
import { getHealthDashboard } from "@/lib/health/dashboard";
import { HealthDashboardClient } from "./health-dashboard";

export default async function HealthPage() {
  const { tiles, incidents } = await getHealthDashboard();

  return (
    <>
      <TopBar title="Health" />
      <main className="p-5">
        <HealthDashboardClient tiles={tiles} incidents={incidents} />
      </main>
    </>
  );
}
