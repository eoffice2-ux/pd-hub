import { getOAuthSettings } from "../../../_lib/repos/system-settings-repo.js";
import { jsonResponse } from "../../../_lib/security.js";

const ALLOWED_OAUTH_DOMAINS = [
  "pd-onestop.pages.dev",
  "pd-onestop.centralhub.io.vn",
  "localhost",
  "127.0.0.1"
];

export function resolveOAuthRedirectUri(request, env) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();

  if (ALLOWED_OAUTH_DOMAINS.includes(hostname) || hostname.endsWith(".pd-onestop.pages.dev")) {
    return `${url.protocol}//${url.host}/api/auth/oauth/callback`;
  }

  const fallback = String(env.OAUTH_DEFAULT_DOMAIN || "pd-onestop.centralhub.io.vn").trim();
  return `https://${fallback}/api/auth/oauth/callback`;
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;
  const url = new URL(request.url);

  const provider = String(url.searchParams.get("provider") || "google").toLowerCase().trim();
  const portal = String(url.searchParams.get("portal") || "trainee").toLowerCase().trim();

  const settings = await getOAuthSettings(env);
  const redirectUri = resolveOAuthRedirectUri(request, env);

  // Generate random nonce and state
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const statePayload = {
    nonce,
    portal,
    provider,
    origin: `${url.protocol}//${url.host}`
  };
  const stateStr = btoa(JSON.stringify(statePayload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  if (provider === "google") {
    if (!settings.google.clientId) {
      return jsonResponse({
        success: false,
        error: "Google OAuth is not configured yet. An administrator must set Google Client ID in the Admin portal."
      }, 400);
    }

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", settings.google.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", stateStr);
    authUrl.searchParams.set("prompt", "select_account");

    return Response.redirect(authUrl.toString(), 302);
  }

  if (provider === "microsoft" || provider === "ms") {
    if (!settings.microsoft.clientId) {
      return jsonResponse({
        success: false,
        error: "Microsoft OAuth is not configured yet. An administrator must set Microsoft Client ID in the Admin portal."
      }, 400);
    }

    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", settings.microsoft.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("scope", "openid email profile User.Read");
    authUrl.searchParams.set("state", stateStr);
    authUrl.searchParams.set("prompt", "select_account");

    return Response.redirect(authUrl.toString(), 302);
  }

  return jsonResponse({ success: false, error: "Invalid provider. Must be 'google' or 'microsoft'." }, 400);
}
