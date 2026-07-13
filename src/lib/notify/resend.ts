import { Resend } from "resend";
import type { NotifyChannel, NotifyPayload } from "@/lib/notify/types";

export function createResendChannel(): NotifyChannel | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ALERT_EMAIL_TO?.trim();
  const from =
    process.env.ALERT_EMAIL_FROM?.trim() || "Mercata Control <alerts@mercata.co.za>";
  if (!apiKey || !to) return null;

  const resend = new Resend(apiKey);

  return {
    name: "resend",
    async send(payload: NotifyPayload) {
      const { error } = await resend.emails.send({
        from,
        to: [to],
        subject: payload.subject,
        text: payload.body,
      });
      if (error) {
        throw new Error(`Resend: ${error.message}`);
      }
    },
  };
}
