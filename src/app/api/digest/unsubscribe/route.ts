import { processUnsubscribe } from "@/lib/digest/unsubscribe";

export const dynamic = "force-dynamic";

function page(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Georgia, serif; background: #F8F7F5; color: #121820; }
    main { max-width: 420px; margin: 64px auto; padding: 0 20px; text-align: center; }
    p { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #5C6470; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1 style="font-size: 22px; font-weight: 400;">${title}</h1>
    <p>${body}</p>
  </main>
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Public unsubscribe — sets digest_cadence = 'off' for the tenant. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return page("Unsubscribe", "This link is missing or invalid.");
  }

  const result = await processUnsubscribe(token);
  if (!result.ok) {
    return page("Unsubscribe", result.error);
  }

  return page(
    "Unsubscribed",
    `Analytics digests for <strong>${escapeHtml(result.tradingName)}</strong> are now off. You can turn them back on from Mercata Control.`,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
