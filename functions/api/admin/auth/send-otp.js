import { generateOtp, getOtpTtlSeconds, isRealOtpEnabled, sendOtpEmail, storeOtp } from "../../../_lib/otp.js";
import { isAdminEmail, jsonResponse, normalizeEmail, readJson } from "../../../_lib/security.js";
import { appendAppLog } from "../../../_lib/app-logs.js";
import { getUserRole } from "../../../_lib/user-roles.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const email = normalizeEmail(parsed.data.email);
  if (!email || !email.includes("@")) {
    await appendAppLog(env, { event: "otp_send", scope: "admin", email, success: false, detail: "Missing or invalid email.", request: context.request });
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }
  // Allow: in ADMIN_EMAILS env OR has a valid role in pdc_user_roles sheet
  const isEnvAdmin = isAdminEmail(email, env);
  const sheetRole = isEnvAdmin ? null : await getUserRole(env, email);
  if (!isEnvAdmin && !sheetRole) {
    await appendAppLog(env, { event: "otp_send", scope: "admin", email, success: false, detail: "Email not authorized for admin/report access.", request: context.request });
    return jsonResponse({ success: false, error: "This email is not authorized for admin or report access." }, 403);
  }
  if (!isRealOtpEnabled(env)) {
    await appendAppLog(env, { event: "otp_send", scope: "admin", email, success: false, detail: "Admin OTP requires OTP_MODE=email.", request: context.request });
    return jsonResponse({ success: false, error: "Admin OTP requires OTP_MODE=email." }, 503);
  }

  const otp = generateOtp();
  try {
    const stored = await storeOtp(env, { email, otp, scope: "admin", request: context.request });
    const sent = await sendOtpEmail(env, { to: email, otp, scope: "admin" });
    await appendAppLog(env, { event: "otp_send", scope: "admin", email, success: true, provider: sent.provider, messageId: sent.id, detail: "Admin OTP email sent.", request: context.request });

    return jsonResponse({
    success: true,
    source: "email",
    message: "Admin OTP sent to email.",
    data: { email, provider: sent.provider, messageId: sent.id, expiresAt: stored.expiresAt, expiresInSeconds: getOtpTtlSeconds(env) }
  });
  } catch (err) {
    await appendAppLog(env, { event: "otp_send", scope: "admin", email, success: false, detail: err?.message || String(err), request: context.request });
    throw err;
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/admin/auth/send-otp" }, 405);
}
