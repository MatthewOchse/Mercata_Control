import { contrastOnPrimary } from "@/lib/digest/brand";
import { emailTokens, esc } from "@/lib/digest/email-tokens";
import { formatZAR } from "@/lib/money";
import { pctChange, type DigestPayload } from "@/lib/digest/types";

function changeHtml(current: number, previous: number): string {
  const pct = pctChange(current, previous);
  if (pct === null) {
    return `<span style="color:${emailTokens.muted};font-size:11px;">vs prior: new</span>`;
  }
  if (pct === 0) {
    return `<span style="color:${emailTokens.muted};font-size:11px;">0% vs prior</span>`;
  }
  const up = pct > 0;
  const color = up ? emailTokens.positive : emailTokens.negative;
  const arrow = up ? "↑" : "↓";
  return `<span style="color:${color};font-size:11px;font-weight:600;">${arrow} ${Math.abs(pct)}% vs prior</span>`;
}

function metricRow(label: string, valueHtml: string, change: string): string {
  return `
    <td align="left" valign="top" width="50%" style="padding:10px 10px 10px 0;width:50%;">
      <div style="font-family:${emailTokens.fontSans};font-size:10px;letter-spacing:0.04em;text-transform:uppercase;color:${emailTokens.muted};line-height:1.35;max-width:100%;word-wrap:break-word;overflow-wrap:anywhere;">${esc(label)}</div>
      <div style="font-family:${emailTokens.fontSerif};font-size:17px;line-height:1.25;color:${emailTokens.foreground};margin-top:4px;max-width:100%;word-wrap:break-word;overflow-wrap:anywhere;">${valueHtml}</div>
      <div style="font-family:${emailTokens.fontSans};margin-top:3px;line-height:1.3;">${change}</div>
    </td>`;
}

function sectionHeading(title: string): string {
  return `
    <tr>
      <td style="padding:28px 0 8px;font-family:${emailTokens.fontSerif};font-size:18px;color:${emailTokens.foreground};border-bottom:1px solid ${emailTokens.border};">
        ${esc(title)}
      </td>
    </tr>`;
}

function archMarkImg(appUrl: string): string {
  const src = `${appUrl.replace(/\/$/, "")}/brand/mercata-notext.webp`;
  return `<img src="${esc(src)}" width="28" height="28" alt="" style="display:inline-block;vertical-align:middle;border:0;outline:none;" />`;
}

export function renderDigestSubject(payload: DigestPayload): string {
  const kind =
    payload.cadence === "weekly"
      ? "Weekly"
      : payload.cadence === "monthly"
        ? "Monthly"
        : "Daily";
  return `${kind} summary — ${payload.brand.tradingName} (${payload.period.label})`;
}

export function renderDigestText(payload: DigestPayload): string {
  const lines = [
    `${payload.brand.tradingName} — ${payload.cadence} summary`,
    payload.period.label,
    "",
    `Sales: ${formatZAR(payload.sales.netSalesCents)}`,
    `Sales and orders: ${payload.sales.ordersCount}`,
    ...(payload.sales.eventsGrossCents != null &&
    payload.sales.eventsGrossCents > 0
      ? [
          `Events revenue: ${formatZAR(payload.sales.eventsGrossCents)} (${payload.sales.eventsBookingsCount ?? 0} bookings)`,
        ]
      : []),
    `Average sales and orders: ${formatZAR(payload.sales.averageOrderValueCents)}`,
    `Customers: ${payload.sales.customers.new} new, ${payload.sales.customers.returning} returning`,
    "",
  ];
  if (payload.sales.topProducts.length) {
    lines.push("Top products:");
    for (const p of payload.sales.topProducts) {
      lines.push(`  - ${p.description} (${p.units})`);
    }
    lines.push("");
  }
  if (payload.traffic) {
    lines.push(
      `Sessions: ${payload.traffic.sessions}`,
      `Users: ${payload.traffic.users}`,
      "",
    );
  }
  lines.push(
    "Delivered by Mercata",
    `Unsubscribe: ${payload.unsubscribeUrl}`,
  );
  return lines.join("\n");
}

/**
 * Responsive table-based HTML email.
 * Header band = tenant primary; body = neutral light surface (dark-mode safe).
 */
export function renderDigestHtml(
  payload: DigestPayload,
  opts?: { appUrl?: string },
): string {
  const t = emailTokens;
  const primary = payload.brand.primaryColor;
  const onPrimary = contrastOnPrimary(primary);
  const appUrl = opts?.appUrl ?? process.env.APP_URL ?? "http://localhost:3000";

  const sales = payload.sales;
  const prev = payload.previousSales;

  const logoBlock = payload.brand.logoUrl
    ? `<img src="${esc(payload.brand.logoUrl)}" alt="${esc(payload.brand.tradingName)}" width="140" style="display:block;max-width:140px;height:auto;border:0;outline:none;" />`
    : `<div style="font-family:${t.fontSerif};font-size:22px;font-weight:700;color:${onPrimary};">${esc(payload.brand.tradingName)}</div>`;

  const topProductsRows =
    sales.topProducts.length === 0
      ? `<tr><td colspan="2" style="padding:8px 0;font-family:${t.fontSans};font-size:13px;color:${t.muted};">No products in this period</td></tr>`
      : sales.topProducts
          .map(
            (p, i) => `
          <tr>
            <td style="padding:8px 0;font-family:${t.fontSans};font-size:13px;color:${t.foreground};border-bottom:1px solid ${t.border};word-wrap:break-word;overflow-wrap:anywhere;">
              <span style="color:${t.muted};margin-right:8px;">${i + 1}.</span>${esc(p.description)}
            </td>
            <td align="right" style="padding:8px 0 8px 8px;font-family:${t.fontSans};font-size:13px;color:${t.foreground};border-bottom:1px solid ${t.border};white-space:nowrap;vertical-align:top;">
              ${p.units} sold
            </td>
          </tr>`,
          )
          .join("");

  let trafficSection = "";
  if (payload.traffic) {
    const sourcesRows =
      payload.traffic.topSources.length === 0
        ? `<tr><td style="padding:8px 0;font-family:${t.fontSans};font-size:14px;color:${t.muted};">No traffic sources</td></tr>`
        : payload.traffic.topSources
            .slice(0, 3)
            .map(
              (s) => `
            <tr>
              <td style="padding:8px 0;font-family:${t.fontSans};font-size:14px;color:${t.foreground};border-bottom:1px solid ${t.border};">${esc(s.source)}</td>
              <td align="right" style="padding:8px 0;font-family:${t.fontSans};font-size:14px;color:${t.foreground};border-bottom:1px solid ${t.border};">${s.sessions}</td>
            </tr>`,
            )
            .join("");

    trafficSection = `
      ${sectionHeading("Traffic")}
      <tr>
        <td style="padding:16px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              ${metricRow("Sessions", String(payload.traffic.sessions), `<span style="color:${t.muted};font-size:11px;">${payload.traffic.users} users</span>`)}
              ${metricRow(
                "Top source",
                esc(payload.traffic.topSources[0]?.source ?? "—"),
                `<span style="color:${t.muted};font-size:11px;">${payload.traffic.topSources[0]?.sessions ?? 0} sessions</span>`,
              )}
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
            <tr>
              <td style="padding:8px 0;font-family:${t.fontSans};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${t.muted};">Top sources</td>
              <td align="right" style="padding:8px 0;font-family:${t.fontSans};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${t.muted};">Sessions</td>
            </tr>
            ${sourcesRows}
          </table>
        </td>
      </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${esc(renderDigestSubject(payload))}</title>
  <!--[if mso]><style>body,table,td{font-family:Georgia,serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${t.bodyBg};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${esc(payload.brand.tradingName)} summary for ${esc(payload.period.label)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${t.bodyBg};">
    <tr>
      <td align="center" style="padding:16px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${t.surface};border:1px solid ${t.border};">
          <!-- Header band: tenant brand -->
          <tr>
            <td bgcolor="${primary}" style="background-color:${primary};padding:22px 20px 20px;">
              ${logoBlock}
              <div style="font-family:${t.fontSans};font-size:12px;color:${onPrimary};opacity:0.85;margin-top:12px;line-height:1.35;">
                ${payload.cadence === "weekly" ? "Weekly" : payload.cadence === "monthly" ? "Monthly" : "Daily"} summary · ${esc(payload.period.label)}
              </div>
            </td>
          </tr>
          <!-- Neutral body -->
          <tr>
            <td bgcolor="${t.surface}" style="background-color:${t.surface};padding:8px 20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${sectionHeading("Sales")}
                <tr>
                  <td style="padding:16px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        ${metricRow(
                          "Net sales",
                          esc(formatZAR(sales.netSalesCents)),
                          changeHtml(sales.netSalesCents, prev.netSalesCents),
                        )}
                        ${metricRow(
                          "Sales and orders",
                          String(sales.ordersCount),
                          changeHtml(sales.ordersCount, prev.ordersCount),
                        )}
                      </tr>
                      <tr>
                        ${metricRow(
                          "Average sales and orders",
                          esc(formatZAR(sales.averageOrderValueCents)),
                          changeHtml(
                            sales.averageOrderValueCents,
                            prev.averageOrderValueCents,
                          ),
                        )}
                        ${
                          sales.eventsGrossCents != null &&
                          sales.eventsGrossCents > 0
                            ? metricRow(
                                "Events revenue",
                                esc(formatZAR(sales.eventsGrossCents)),
                                `<span style="color:${t.muted};font-size:11px;">${sales.eventsBookingsCount ?? 0} booking${(sales.eventsBookingsCount ?? 0) === 1 ? "" : "s"}</span>`,
                              )
                            : payload.conversionRate !== null
                              ? metricRow(
                                  "Conversion",
                                  `${payload.conversionRate}%`,
                                  `<span style="color:${t.muted};font-size:11px;">orders ÷ sessions</span>`,
                                )
                              : metricRow(
                                  "Customers",
                                  `${sales.customers.new + sales.customers.returning}`,
                                  `<span style="color:${t.muted};font-size:11px;">${sales.customers.new} new · ${sales.customers.returning} returning</span>`,
                                )
                        }
                      </tr>
                    </table>
                    ${
                      payload.contextLine
                        ? `<p style="font-family:${t.fontSans};font-size:13px;color:${t.foreground};margin:16px 0 0;line-height:1.4;">${esc(payload.contextLine)}</p>`
                        : ""
                    }
                  </td>
                </tr>
                ${sectionHeading("Top products")}
                <tr>
                  <td style="padding:8px 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${topProductsRows}
                    </table>
                  </td>
                </tr>
                ${trafficSection}
                ${
                  payload.showSettleNote
                    ? `<tr><td style="padding:20px 0 0;font-family:${t.fontSans};font-size:12px;color:${t.muted};line-height:1.45;">Traffic figures for the most recent 48 hours may still settle; sales figures are final.</td></tr>`
                    : ""
                }
              </table>
            </td>
          </tr>
          <!-- Mercata footer only -->
          <tr>
            <td bgcolor="${t.background}" style="background-color:${t.background};padding:18px 20px;border-top:1px solid ${t.border};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${t.fontSans};font-size:12px;color:${t.muted};line-height:1.5;">
                    ${archMarkImg(appUrl)}
                    <span style="margin-left:8px;vertical-align:middle;">Delivered by Mercata</span>
                    <br />
                    <a href="${esc(payload.unsubscribeUrl)}" style="color:${t.muted};text-decoration:underline;">Unsubscribe from these digests</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
