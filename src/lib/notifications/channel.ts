/**
 * Customer-facing notification channels (digest email today; WhatsApp later).
 * Distinct from lib/notify (operator alerts).
 */

export type NotificationPayload = {
  to: string;
  subject: string;
  /** Plain-text fallback */
  text: string;
  /** HTML body when the channel supports it */
  html?: string;
  tenantSlug: string;
  kind: "digest" | "other";
};

export interface NotificationChannel {
  readonly name: string;
  send(payload: NotificationPayload): Promise<void>;
}
