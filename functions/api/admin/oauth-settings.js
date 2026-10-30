import { jsonResponse, readJson, requireAdminSession } from "../../_lib/security.js";
import { isSuperUser } from "../../_lib/user-roles.js";
import { getOAuthSettings, setSystemSetting } from "../../_lib/repos/system-settings-repo.js";
import { appendAppLog } from "../../_lib/app-logs.js";

async function verifySuperUserAuth(request, env) {
  const adminAuth = await requireAdminSession(request, env);
  if (!adminAuth.ok) return { ok: false, response: adminAuth.response };

  const email = adminAuth.session.email;
  const authorized = await isSuperUser(env, email);
  if (!authorized) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Forbidden. Only Super Users can view or configure OAuth credentials."
      }, 403)
    };
  }

  return { ok: true, email };
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  const auth = await verifySuperUserAuth(request, env);
  if (!auth.ok) return auth.response;

  try {
    const settings = await getOAuthSettings(env);
    // Mask secrets for display
    const mask = (s) => s ? `${s.slice(0, 4)}••••••••${s.slice(-4)}` : "";

    return jsonResponse({
      success: true,
      data: {
        google: {
          clientId: settings.google.clientId,
          clientSecretMasked: mask(settings.google.clientSecret),
          hasSecret: Boolean(settings.google.clientSecret),
          isConfigured: settings.google.isConfigured
        },
        microsoft: {
          clientId: settings.microsoft.clientId,
          clientSecretMasked: mask(settings.microsoft.clientSecret),
          hasSecret: Boolean(settings.microsoft.clientSecret),
          isConfigured: settings.microsoft.isConfigured
        },
        registeredDomains: [
          "pd-onestop.centralhub.io.vn",
          "pd-onestop.pages.dev"
        ]
      }
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  const auth = await verifySuperUserAuth(request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const { googleClientId, googleClientSecret, msClientId, msClientSecret } = parsed.data || {};

  try {
    if (googleClientId !== undefined) {
      await setSystemSetting(env, "oauth_google_client_id", String(googleClientId).trim(), auth.email);
    }
    if (googleClientSecret !== undefined && String(googleClientSecret).trim() && !String(googleClientSecret).includes("••••")) {
      await setSystemSetting(env, "oauth_google_client_secret", String(googleClientSecret).trim(), auth.email);
    }

    if (msClientId !== undefined) {
      await setSystemSetting(env, "oauth_microsoft_client_id", String(msClientId).trim(), auth.email);
    }
    if (msClientSecret !== undefined && String(msClientSecret).trim() && !String(msClientSecret).includes("••••")) {
      await setSystemSetting(env, "oauth_microsoft_client_secret", String(msClientSecret).trim(), auth.email);
    }

    await appendAppLog(env, {
      event: "admin_oauth_settings_update",
      scope: "admin",
      email: auth.email,
      success: true,
      detail: JSON.stringify({
        googleConfigured: Boolean(googleClientId),
        msConfigured: Boolean(msClientId)
      }),
      request
    });

    return jsonResponse({ success: true, message: "OAuth credentials updated successfully." });
  } catch (err) {
    await appendAppLog(env, {
      event: "admin_oauth_settings_update",
      scope: "admin",
      email: auth.email,
      success: false,
      detail: err.message || String(err),
      request
    });
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}
