import { jsonResponse, normalizeEmail, readJson } from "../../_lib/security.js";
import { generateOtp, getOtpTtlSeconds, isRealOtpEnabled, sendOtpEmail, storeOtp } from "../../_lib/otp.js";
import { appendAppLog } from "../../_lib/app-logs.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const email = normalizeEmail(parsed.data.email);
  const scope = String(parsed.data.scope || parsed.data.audience || "client").toLowerCase();
  if (!email || !email.includes("@")) {
    await appendAppLog(env, { event: "otp_send", scope, email, success: false, detail: "Missing or invalid email.", request: context.request });
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }

  if (!isRealOtpEnabled(env)) {
    await appendAppLog(env, { event: "otp_send", scope, email, success: true, provider: "mock", detail: "Mock OTP request accepted.", request: context.request });
    return jsonResponse({
      success: true,
      source: "mock",
      message: "OTP request accepted. Use the configured mock OTP to continue.",
      data: { email, expiresInSeconds: getOtpTtlSeconds(env) }
    });
  }

  const otp = generateOtp();
  try {
    const stored = await storeOtp(env, { email, otp, scope, request: context.request });
    const sent = await sendOtpEmail(env, { to: email, otp, scope });
    await appendAppLog(env, { event: "otp_send", scope, email, success: true, provider: sent.provider, messageId: sent.id, detail: "OTP email sent.", request: context.request });

    return jsonResponse({
    success: true,
    source: "email",
    message: "OTP sent to email.",
    data: {
      email,
      provider: sent.provider,
      messageId: sent.id,
      expiresAt: stored.expiresAt,
      expiresInSeconds: stored.expiresInSeconds
      }
    });
  } catch (err) {
    await appendAppLog(env, { event: "otp_send", scope, email, success: false, detail: err?.message || String(err), request: context.request });
    throw err;
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/auth/send-otp" }, 405);
}
