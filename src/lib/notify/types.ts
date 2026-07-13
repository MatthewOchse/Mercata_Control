export type NotifyPayload = {
  subject: string;
  body: string;
  severity: "critical" | "warning" | "info";
  tenantSlug?: string;
  signal?: string;
};

export interface NotifyChannel {
  readonly name: string;
  send(payload: NotifyPayload): Promise<void>;
}
