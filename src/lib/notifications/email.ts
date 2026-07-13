import { Resend } from "resend";
import type {
  NotificationChannel,
  NotificationPayload,
} from "@/lib/notifications/channel";

function digestFrom(): string {
  return (
    process.env.DIGEST_EMAIL_FROM?.trim() ||
    "Mercata <digests@mercata.co.za>"
  );
}

export function createDigestEmailChannel(): NotificationChannel | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  const resend = new Resend(apiKey);

  return {
    name: "email",
    async send(payload: NotificationPayload) {
      const { error } = await resend.emails.send({
        from: digestFrom(),
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      if (error) throw new Error(`Resend: ${error.message}`);
    },
  };
}
