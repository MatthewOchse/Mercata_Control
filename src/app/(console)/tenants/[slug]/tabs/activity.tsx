import type { AuditRow } from "@/lib/tenants/types";

export function ActivityTab({
  rows,
  formatSastDateTime,
}: {
  rows: AuditRow[];
  formatSastDateTime: (value: Date | string | null | undefined) => string;
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-muted">No activity yet</p>;
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Actor</th>
          <th>Action</th>
          <th>Entity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap font-mono text-[11px]">
              {formatSastDateTime(r.created_at)}
            </td>
            <td className="text-[12px]">{r.actor}</td>
            <td className="font-mono text-[12px]">{r.action}</td>
            <td className="font-mono text-[11px] text-muted">
              {r.entity_type}:{r.entity_id}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
