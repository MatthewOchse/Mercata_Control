import { TopBar } from "@/components/layout/top-bar";
import { requireOperator } from "@/lib/auth/server";
import { getProvisioningJob } from "@/lib/provisioning/jobs";
import { auditProvision } from "@/lib/provisioning/audit";
import { getServerById } from "@/lib/servers/queries";
import { notFound } from "next/navigation";
import { ProvisionJobStatusClient } from "./status-client";

export default async function ProvisionJobStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const operator = await requireOperator();
  if (!operator.is_super) {
    return (
      <>
        <TopBar title="Provision" />
        <main className="p-5">
          <p className="text-[13px] text-status-error">
            Super-admin access required.
          </p>
        </main>
      </>
    );
  }

  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const job = await getProvisioningJob(id);
  if (!job) notFound();

  const targetServer = await getServerById(job.target_server_id);

  await auditProvision({
    actor: operator.email,
    action: "provision.view",
    jobId: job.id,
    tenantId: job.tenant_id,
    after: { status: job.status, targetServerId: job.target_server_id },
  });

  return (
    <>
      <TopBar title={`Provision #${job.id}`} />
      <main className="p-5">
        <ProvisionJobStatusClient
          initialJob={job}
          targetServer={
            targetServer
              ? {
                  id: targetServer.id,
                  name: targetServer.name,
                  publicIp: targetServer.publicIp,
                }
              : null
          }
        />
      </main>
    </>
  );
}
