/**
 * Public storefront holding page. No billing, no Mercata branding,
 * no non-payment language — customers are not party to the commercial dispute.
 */
export function renderSuspensionHoldingPage(tradingName: string): string {
  const name = escapeHtml(tradingName.trim() || "This store");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600&display=swap" rel="stylesheet"/>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0b1c2c;
    color: #f4f1ea;
    font-family: Spectral, Georgia, serif;
    padding: 2rem;
  }
  main { max-width: 28rem; text-align: center; }
  h1 {
    margin: 0 0 1rem;
    font-size: clamp(1.6rem, 4vw, 2.1rem);
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  p {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.55;
    color: rgba(244, 241, 234, 0.82);
  }
</style>
</head>
<body>
  <main>
    <h1>${name}</h1>
    <p>This store is temporarily unavailable. Please contact the store owner.</p>
  </main>
</body>
</html>`;
}

export const HOLDING_PAGE_MARKER =
  "This store is temporarily unavailable. Please contact the store owner.";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
