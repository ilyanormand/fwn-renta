// Lightweight email notifier using Resend HTTP API
// Reads settings from environment variables with safe defaults.

type ParsingOutcome = {
  success: boolean;
  supplierName: string;
  totalPrice?: number;
  itemsCount?: number;
  warnings?: string[];
  errorMessage?: string;
};

function loadDotEnvIfPresent() {
  try {
    // Lazy, dependency-free .env loader (only if dotenv is not installed)
    if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_TO) {
      const fs = require("fs");
      const path = require("path");
      const envPath = path.join(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
          if (!m) continue;
          const key = m[1];
          let val = m[2];
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (process.env[key] == null) process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore; environment will fall back to defaults below
  }
}

loadDotEnvIfPresent();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_TO = process.env.NOTIFY_TO;
const NOTIFY_FROM = process.env.NOTIFY_FROM;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`Resend API error: ${msg}`);
  }
  return json;
}

function buildEmail(outcome: ParsingOutcome): {
  subject: string;
  html: string;
  text: string;
} {
  const when = new Date().toISOString();
  if (outcome.success) {
    const subject = `✅ PDF parsed successfully · ${outcome.supplierName}`;
    const text = [
      `Parsing succeeded`,
      `Supplier: ${outcome.supplierName}`,
      outcome.totalPrice != null
        ? `Total: ${outcome.totalPrice.toFixed(2)} EUR`
        : undefined,
      `Items: ${outcome.itemsCount ?? 0}`,
      outcome.warnings?.length
        ? `Warnings: ${outcome.warnings.join(" | ")}`
        : undefined,
      `Time: ${when}`,
    ]
      .filter(Boolean)
      .join("\n");
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
        <h2>✅ Parsing succeeded</h2>
        <ul>
          <li><b>Supplier:</b> ${escapeHtml(outcome.supplierName)}</li>
          ${outcome.totalPrice != null ? `<li><b>Total:</b> ${escapeHtml(outcome.totalPrice.toFixed(2))} EUR</li>` : ""}
          <li><b>Items:</b> ${escapeHtml(String(outcome.itemsCount ?? 0))}</li>
          ${outcome.warnings?.length ? `<li><b>Warnings:</b> ${escapeHtml(outcome.warnings.join(" | "))}</li>` : ""}
          <li><b>Time:</b> ${escapeHtml(when)}</li>
        </ul>
      </div>`;
    return { subject, html, text };
  }
  const subject = `❌ PDF parsing failed · ${outcome.supplierName}`;
  const text = [
    `Parsing failed`,
    `Supplier: ${outcome.supplierName}`,
    outcome.totalPrice != null
      ? `Total: ${outcome.totalPrice.toFixed(2)} EUR`
      : undefined,
    outcome.errorMessage ? `Error: ${outcome.errorMessage}` : undefined,
    `Time: ${when}`,
  ]
    .filter(Boolean)
    .join("\n");
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5;">
      <h2>❌ Parsing failed</h2>
      <ul>
        <li><b>Supplier:</b> ${escapeHtml(outcome.supplierName)}</li>
        ${outcome.totalPrice != null ? `<li><b>Total:</b> ${escapeHtml(outcome.totalPrice.toFixed(2))} EUR</li>` : ""}
        ${outcome.errorMessage ? `<li><b>Error:</b> ${escapeHtml(outcome.errorMessage)}</li>` : ""}
        <li><b>Time:</b> ${escapeHtml(when)}</li>
      </ul>
    </div>`;
  return { subject, html, text };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendParsingEmail(outcome: ParsingOutcome): Promise<void> {
  console.log("Attempting to send email with config:", {
    hasApiKey: !!RESEND_API_KEY,
    notifyTo: [
      "ilya@1-tn.com",
      "normand3533@gmail.com",
      "fitness.world@outlook.fr",
    ],
    notifyFrom: NOTIFY_FROM,
    outcome: outcome,
  });

  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set; skipping email notification");
    return;
  }

  const { subject, html, text } = buildEmail(outcome);
  console.log("Email content prepared:", {
    subject,
    to: ["normand3533@gmail.com", "ilya@1-tn.com", "fitness.world@outlook.fr"],
    from: NOTIFY_FROM,
  });

  try {
    const result = await postJson(
      "https://api.resend.com/emails",
      {
        from: NOTIFY_FROM,
        to: [
          "ilya@1-tn.com",
          "normand3533@gmail.com",
          "fitness.world@outlook.fr",
        ],
        subject,
        html,
        text,
      },
      {
        Authorization: `Bearer ${RESEND_API_KEY}`,
      }
    );
    console.log("Email sent successfully:", result);
  } catch (e: any) {
    console.error("Failed to send Resend email:", e?.message || e);
    throw e; // Re-throw to see the error in the calling code
  }
}
