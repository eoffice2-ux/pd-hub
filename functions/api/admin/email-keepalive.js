import { jsonResponse } from "../../_lib/security.js";
import { sendViaBrevo } from "../../_lib/email-sender.js";

export async function onRequestPost(context) {
  const { env, request } = context;
  const token =
    request.headers.get("x-keepalive-token") ||
    new URL(request.url).searchParams.get("token") ||
    "";
  const expected = String(env.KEEPALIVE_TOKEN || "").trim();

  if (!expected || token !== expected) {
    return jsonResponse({ success: false, error: "Unauthorized." }, 401);
  }

  const to = String(env.KEEPALIVE_TO || env.OTP_FROM_EMAIL || "eoffice2@eiu.edu.vn").trim();
  const fromEmail = String(env.OTP_FROM_EMAIL || "eoffice2@eiu.edu.vn").trim();
  const fromName  = String(env.OTP_FROM_NAME  || "PD Hub").trim();
  const subject   = "PD Hub — Email Service Keep-Alive [Brevo]";
  const html      = `<p>This is an automated quarterly keep-alive ping from PD Hub to maintain Brevo API activity. No action required.</p><p>Timestamp: ${new Date().toISOString()}</p>`;
  const text      = `PD Hub email keep-alive ping. Timestamp: ${new Date().toISOString()}`;
  const results   = [];

  // Keep-alive via Brevo
  try {
    const r = await sendViaBrevo(env, {
      to,
      fromEmail,
      fromName,
      subject,
      html,
      text,
      logContext: "Keepalive-Brevo"
    });
    results.push({ provider: "brevo", status: "sent", id: r.id });
  } catch (e) {
    results.push({ provider: "brevo", status: "failed", error: e.message });
  }

  const allOk = results.length > 0 && results.every((r) => r.status === "sent");
  return jsonResponse(
    {
      success: allOk,
      to,
      results,
      timestamp: new Date().toISOString()
    },
    allOk ? 200 : 207
  );
}
