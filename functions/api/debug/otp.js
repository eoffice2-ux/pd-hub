import { jsonResponse, requireDebugToken } from "../../_lib/security.js";
import { getEmailProvider, getOtpMode, getOtpSheetName, getOtpTtlSeconds, isRealOtpEnabled } from "../../_lib/otp.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;
  return jsonResponse({
    success: true,
    otp: {
      mode: getOtpMode(env),
      realOtpEnabled: isRealOtpEnabled(env),
      provider: getEmailProvider(env),
      fromEmailPresent: Boolean(env.OTP_FROM_EMAIL || env.MAIL_FROM_EMAIL),
      resendApiKeyPresent: Boolean(env.RESEND_API_KEY),
      brevoApiKeyPresent: Boolean(env.BREVO_API_KEY),
      otpSheetName: getOtpSheetName(env),
      ttlSeconds: getOtpTtlSeconds(env),
      googleSheetsConfigured: Boolean(env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY && (env.GOOGLE_SHEET_ID_CORE || env.GOOGLE_SHEET_ID)),
      sessionSecretPresent: Boolean(env.API_SESSION_SECRET)
    }
  });
}
