import type { NotifyChannel, NotifyPayload } from "@/lib/notify/types";

/**
 * Generic webhook adapter — point ALERT_WEBHOOK_URL at ntfy, Telegram bot
 * gateway, or any POST-JSON receiver.
 *
 * Body shape:
 * { subject, body, severity, tenantSlug?, signal?, title, message }
 */
export function createWebhookChannel(): NotifyChannel | null {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return null;

  return {
    name: "webhook",
    async send(payload: NotifyPayload) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.ALERT_WEBHOOK_TOKEN
            ? {
                authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN.trim()}`,
              }
            : {}),
        },
        body: JSON.stringify({
          subject: payload.subject,
          body: payload.body,
          title: payload.subject,
          message: payload.body,
          severity: payload.severity,
          tenantSlug: payload.tenantSlug,
          signal: payload.signal,
        }),
      });
      if (!res.ok) {
        throw new Error(`Webhook HTTP ${res.status}`);
      }
    },
  };
}
