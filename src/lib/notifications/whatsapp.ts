import type {
  NotificationChannel,
  NotificationPayload,
} from "@/lib/notifications/channel";

/**
 * WhatsApp adapter — scaffold only. Do not implement.
 *
 * Requires: WhatsApp Business API via a BSP, pre-approved templates,
 * documented opt-in (see tenant_contacts.whatsapp_opt_in), and per-conversation costs.
 */
export class WhatsAppNotificationChannel implements NotificationChannel {
  readonly name = "whatsapp";

  async send(_payload: NotificationPayload): Promise<void> {
    void _payload;
    throw new Error(
      "WhatsApp notification channel is not implemented. Consent fields exist on tenant_contacts; wire a BSP adapter later.",
    );
  }
}

export function createWhatsAppChannel(): NotificationChannel | null {
  // Intentionally never enabled — scaffold for a future drop-in.
  return null;
}
