import { NextResponse } from "next/server";
import { getCurrentOperator } from "@/lib/auth/server";
import { getProvisioningJob } from "@/lib/provisioning/jobs";

/** Poll job status + log. Never returns secret ciphertext. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const operator = await getCurrentOperator();
  if (!operator?.is_super) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const job = await getProvisioningJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    job: {
      id: job.id,
      tenant_id: job.tenant_id,
      tier: job.tier,
      domain: job.domain,
      db_name: job.db_name,
      target_server_id: job.target_server_id,
      status: job.status,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      log_text: job.log_text,
      non_sensitive_config: job.non_sensitive_config,
    },
  });
}
