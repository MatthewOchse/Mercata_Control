import { createResendChannel } from "@/lib/notify/resend";
import type { NotifyChannel, NotifyPayload } from "@/lib/notify/types";
import { createWebhookChannel } from "@/lib/notify/webhook";

let cached: NotifyChannel[] | null = null;

export function getNotifyChannels(): NotifyChannel[] {
  if (cached) return cached;
  const channels: NotifyChannel[] = [];
  const resend = createResendChannel();
  const webhook = createWebhookChannel();
  if (resend) channels.push(resend);
  if (webhook) channels.push(webhook);
  cached = channels;
  return channels;
}

/** Reset cache (tests / config reload). */
export function resetNotifyChannels(): void {
  cached = null;
}

export async function notifyAll(payload: NotifyPayload): Promise<string[]> {
  const channels = getNotifyChannels();
  if (channels.length === 0) {
    console.warn("[notify] No channels configured — alert dropped:", payload.subject);
    return [];
  }
  const used: string[] = [];
  for (const ch of channels) {
    try {
      await ch.send(payload);
      used.push(ch.name);
    } catch (err) {
      console.error(
        `[notify] ${ch.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return used;
}
