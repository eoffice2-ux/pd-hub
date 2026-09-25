import { issueSessionToken, jsonResponse, normalizeEmail, readJson } from "../../_lib/security.js";
import { isRealOtpEnabled, verifyStoredOtp } from "../../_lib/otp.js";
import { appendAppLog } from "../../_lib/app-logs.js";
import { getUserInfo } from "../../_lib/user-roles.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const email = normalizeEmail(parsed.data.email);
  const otp = String(parsed.data.otp || "").trim();
  const requestedScope = String(parsed.data.scope || parsed.data.audience || "client").toLowerCase();
  const scope = ["client", "trainee", "all"].includes(requestedScope) ? requestedScope : "client";

  if (!email || !email.includes("@")) {
    await appendAppLog(env, { event: "otp_verify", scope, email, success: false, detail: "Missing or invalid email.", request: context.request });
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }

  if (isRealOtpEnabled(env)) {
    const verified = await verifyStoredOtp(env, { email, otp, scope });
    if (!verified.ok) {
      await appendAppLog(env, { event: "otp_verify", scope, email, success: false, detail: verified.error || "Invalid or expired OTP.", request: context.request });
      return jsonResponse({ success: false, error: verified.error || "Invalid or expired OTP." }, 401);
    }
  } else {
    const expectedOtp = String(env.MOCK_OTP || "123456");
    if (otp !== expectedOtp) {
      await appendAppLog(env, { event: "otp_verify", scope, email, success: false, provider: "mock", detail: "Invalid mock OTP.", request: context.request });
      return jsonResponse({ success: false, error: "Invalid or expired OTP." }, 401);
    }
  }

  const session = await issueSessionToken(email, env, scope);
  await appendAppLog(env, { event: "otp_verify", scope, email, success: true, provider: isRealOtpEnabled(env) ? "email" : "mock", detail: "OTP verified and session issued.", request: context.request });

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

  return jsonResponse({
    success: true,
    source: isRealOtpEnabled(env) ? "email" : "mock",
    message: "OTP verified. Session token issued.",
    data: {
      email,
      scope: session.session.scope,
      token: session.token,
      expiresAt: session.expiresAt,
      expiresInSeconds: session.expiresInSeconds,
      hasPin
    }
  });
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/auth/verify-otp" }, 405);
}
