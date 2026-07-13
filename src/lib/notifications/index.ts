/**
 * Customer-facing notification channels.
 * Email is live; WhatsApp is scaffold-only (consent columns on tenant_contacts).
 */
export type {
  NotificationChannel,
  NotificationPayload,
} from "@/lib/notifications/channel";
export { createDigestEmailChannel } from "@/lib/notifications/email";
export {
  WhatsAppNotificationChannel,
  createWhatsAppChannel,
} from "@/lib/notifications/whatsapp";
