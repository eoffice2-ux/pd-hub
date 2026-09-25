/**
 * Unified email sender — round-robin GAS rotation + Brevo/Resend fallback.
 *
 * Slot assignment (deterministic, stateless):
 *   hash(email) % 2 === 0  →  GAS1 primary, GAS2 fallback
 *   hash(email) % 2 === 1  →  GAS2 primary, GAS1 fallback
 *
 * Failure chain (slot 0): GAS1 → Brevo → Resend → GAS2
 * Failure chain (slot 1): GAS2 → Brevo → Resend → GAS1
 */
export async function sendEmail(env, { to, subject, html, text, attachments = [], logContext = "Email" }) {
  const fromEmail = String(env.OTP_FROM_EMAIL || env.MAIL_FROM_EMAIL || "").trim();
  const fromName  = String(env.OTP_FROM_NAME  || env.MAIL_FROM_NAME  || "PD Hub").trim();
  const gas1Secret = String(env.EMAIL_CENTER_SECRET || "").trim();
  const gas2Secret = String(env.EMAIL_CENTER_SECRET_2 || env.EMAIL_CENTER_SECRET || "").trim();
  const provider   = String(env.OTP_EMAIL_PROVIDER || "brevo").trim().toLowerCase();

  const gas1Url   = String(env.EMAIL_CENTER_URL   || "").trim();
  const gas2Url   = String(env.EMAIL_CENTER_URL_2 || "").trim();
  const slot      = emailSlot(to);

  const [primaryUrl, primarySecret, primaryLabel, fallbackUrl, fallbackSecret, fallbackLabel] = slot === 0
    ? [gas1Url, gas1Secret, "gas1", gas2Url, gas2Secret, "gas2"]
    : [gas2Url, gas2Secret, "gas2", gas1Url, gas1Secret, "gas1"];

  async function tryGas(url, secret, label) {
    if (!url) return null;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res  = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, htmlBody: html, textBody: text, secret, attachments }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      const txt = await res.text();
      let json = {}; try { json = JSON.parse(txt); } catch (_) {}
      const ok = res.ok && (
        json.success === true || json.result === "ok" ||
        json.status === "success" || json.sent === true ||
        (typeof json === "object" && !json.error && Object.keys(json).length > 0)
      );
      if (ok) {
        console.log(`[${logContext}] ✅ Sent via ${label} (slot=${slot}, id=${json.id || "ok"})`);
        return { provider: label, id: json.id || "ok" };
      }
      console.warn(`[${logContext}] ${label} non-success: ${json.error || res.status}`);
    } catch (e) {
      clearTimeout(tid);
      console.warn(`[${logContext}] ${label} error: ${e.name === "AbortError" ? "15s timeout" : e.message}`);
    }
    return null;
  }

  // 1. Primary GAS for this user slot
  const r1 = await tryGas(primaryUrl, primarySecret, primaryLabel);
  if (r1) return r1;

  // 2. Brevo
  if (fromEmail && (provider === "brevo" || env.BREVO_API_KEY)) {
    try {
      const r = await sendViaBrevo(env, { to, fromEmail, fromName, subject, html, text, attachments, logContext });
      if (r) return r;
    } catch (e) {
      console.warn(`[${logContext}] Brevo failed: ${e.message}`);
    }
  }

  // 3. Resend
  if (fromEmail && env.RESEND_API_KEY) {
    try {
      const r = await sendViaResend(env, { to, fromEmail, fromName, subject, html, text, attachments, logContext });
      if (r) return r;
    } catch (e) {
      console.warn(`[${logContext}] Resend failed: ${e.message}`);
    }
  }

  // 4. Fallback GAS (last resort)
  const r4 = await tryGas(fallbackUrl, fallbackSecret, fallbackLabel);
  if (r4) return r4;

  throw new Error(`[${logContext}] All email providers exhausted (slot=${slot}, to=${to}).`);
}

export async function sendViaBrevo(env, { to, fromEmail, fromName, subject, html, text, attachments = [], logContext = "Email" }) {
  const key = String(env.BREVO_API_KEY || "").trim();
  if (!key) throw new Error("Missing BREVO_API_KEY");
  const body = {
    sender: { name: fromName || "PD Hub", email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text
  };
  if (attachments.length) {
    body.attachment = attachments.map(a => ({ name: a.filename, content: a.content }));
  }
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Brevo HTTP ${res.status}`);
  console.log(`[${logContext}] ✅ Sent via Brevo`);
  return { provider: "brevo", id: json?.messageId || json?.messageIds?.[0] || "" };
}

export async function sendViaResend(env, { to, fromEmail, fromName, subject, html, text, attachments = [], logContext = "Email" }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) throw new Error("Missing RESEND_API_KEY");
  const body = {
    from: `${fromName || "PD Hub"} <${fromEmail}>`,
    to: [to],
    subject,
    html,
    text
  };
  if (attachments.length) {
    body.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error || `Resend HTTP ${res.status}`);
  console.log(`[${logContext}] ✅ Sent via Resend`);
  return { provider: "resend", id: json?.id || "" };
}

export function emailSlot(email) {
  // djb2 hash — stateless, deterministic ~50/50 split
  const s = String(email || "").toLowerCase().trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h % 2;
}
