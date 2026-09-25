import { isRealOtpEnabled, verifyStoredOtp } from "../../../_lib/otp.js";
import { isAdminEmail, issueSessionToken, jsonResponse, normalizeEmail, readJson } from "../../../_lib/security.js";
import { appendAppLog } from "../../../_lib/app-logs.js";
import { getUserRole, getUserInfo } from "../../../_lib/user-roles.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const email = normalizeEmail(parsed.data.email);
  const otp = String(parsed.data.otp || "").trim();
  if (!email || !email.includes("@")) {
    await appendAppLog(env, { event: "admin_login", scope: "admin", email, success: false, detail: "Missing or invalid email.", request: context.request });
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }
  // Allow: in ADMIN_EMAILS env OR has a valid role in pdc_user_roles sheet
  const isEnvAdmin = isAdminEmail(email, env);
  const sheetRole = isEnvAdmin ? null : await getUserRole(env, email);
  if (!isEnvAdmin && !sheetRole) {
    await appendAppLog(env, { event: "admin_login", scope: "admin", email, success: false, detail: "Email not authorized for admin/report access.", request: context.request });
    return jsonResponse({ success: false, error: "This email is not authorized for admin or report access." }, 403);
  }
  if (!isRealOtpEnabled(env)) {
    await appendAppLog(env, { event: "admin_login", scope: "admin", email, success: false, detail: "Admin OTP requires OTP_MODE=email.", request: context.request });
    return jsonResponse({ success: false, error: "Admin OTP requires OTP_MODE=email." }, 503);
  }

  const verified = await verifyStoredOtp(env, { email, otp, scope: "admin" });
  if (!verified.ok) {
    await appendAppLog(env, { event: "admin_login", scope: "admin", email, success: false, detail: verified.error || "Invalid or expired OTP.", request: context.request });
    return jsonResponse({ success: false, error: verified.error || "Invalid or expired OTP." }, 401);
  }

  const session = await issueSessionToken(email, env, "admin");

  // Resolve role: reuse sheetRole already fetched, fallback "admin" for ADMIN_EMAILS users
  const resolvedRole = sheetRole || "admin";

  let hasPin = false;
  if (String(env.DB_MODE || "gsheet").toLowerCase() === "mock") {
    const isNewUser = email.includes("new") || email.includes("otp");
    hasPin = !isNewUser;
  } else {
    try {
      const userInfo = await getUserInfo(env, email);
      hasPin = userInfo && userInfo.pin ? true : false;
    } catch (_) {}
  }

  await appendAppLog(env, { event: "admin_login", scope: "admin", email, success: true, detail: `Admin OTP verified. Role: ${resolvedRole}.`, request: context.request });
  return jsonResponse({
    success: true,
    source: "email",
    message: "Admin OTP verified. Session token issued.",
    data: { email, scope: session.session.scope, role: resolvedRole, token: session.token, expiresAt: session.expiresAt, expiresInSeconds: session.expiresInSeconds, hasPin }
  });
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/admin/auth/verify-otp" }, 405);
}
