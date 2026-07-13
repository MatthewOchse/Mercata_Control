import type { StatusTone } from "@/components/ui/status";
import type { TenantStatus } from "@/lib/tenants/types";

export function tenantStatusTone(status: TenantStatus): StatusTone {
  switch (status) {
    case "active":
      return "ok";
    case "suspended":
      return "warn";
    case "offboarded":
      return "error";
    default:
      return "idle";
  }
}

export function tenantStatusLabel(status: TenantStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "prospect":
      return "Prospect";
    case "suspended":
      return "Suspended";
    case "offboarded":
      return "Offboarded";
  }
}

export function invoiceStatusTone(status: string | null): StatusTone {
  switch (status) {
    case "paid":
      return "ok";
    case "issued":
      return "idle";
    case "overdue":
      return "warn";
    case "void":
      return "error";
    case "draft":
      return "idle";
    default:
      return "idle";
  }
}

export function invoiceStatusLabel(status: string | null): string {
  if (!status) return "None";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
