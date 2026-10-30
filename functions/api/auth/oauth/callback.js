import { getOAuthSettings } from "../../../_lib/repos/system-settings-repo.js";
import { getUserRoles, setUserRoles } from "../../../_lib/user-roles.js";
import { issueSessionToken, normalizeEmail, jsonResponse } from "../../../_lib/security.js";
import { appendAppLog } from "../../../_lib/app-logs.js";
import { resolveOAuthRedirectUri } from "./login.js";

function parseJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const jsonStr = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(jsonStr);
  } catch (err) {
    return null;
  }
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const stateStr = url.searchParams.get("state") || "";
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    return new Response(`<h3>Authentication Failed</h3><p>${error}: ${errorDescription || ""}</p><p><a href="/">Return to Home</a></p>`, {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  if (!code) {
    return new Response(`<h3>Authentication Error</h3><p>Missing authorization code from OAuth provider.</p><p><a href="/">Return to Home</a></p>`, {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  // Decode state
  let state = {};
  try {
    let b64 = stateStr.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4;
    if (pad) b64 += "=".repeat(4 - pad);
    state = JSON.parse(atob(b64));
  } catch (_) {
    state = { portal: "trainee", provider: "google" };
  }

  const provider = String(state.provider || "google").toLowerCase();
  const portal = String(state.portal || "trainee").toLowerCase();
  const origin = state.origin || `${url.protocol}//${url.host}`;
  const redirectUri = resolveOAuthRedirectUri(request, env);
  const settings = await getOAuthSettings(env);

  let verifiedEmail = "";
  let userName = "";

  try {
    if (provider === "google") {
      if (!settings.google.clientSecret) {
        throw new Error("Google OAuth Client Secret is not configured. An administrator must set the Client Secret in the Admin portal.");
      }
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: settings.google.clientId,
          client_secret: settings.google.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });

      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.id_token) {
        throw new Error(tokenJson.error_description || tokenJson.error || "Failed to exchange Google OAuth code.");
      }

      const idPayload = parseJwtPayload(tokenJson.id_token);
      if (!idPayload || !idPayload.email) {
        throw new Error("Unable to extract verified email from Google ID token.");
      }

      verifiedEmail = normalizeEmail(idPayload.email);
      userName = idPayload.name || "";
    } else if (provider === "microsoft" || provider === "ms") {
      if (!settings.microsoft.clientSecret) {
        throw new Error("Microsoft OAuth Client Secret is not configured. An administrator must set the Client Secret in the Admin portal.");
      }
      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: settings.microsoft.clientId,
          client_secret: settings.microsoft.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });

      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.id_token) {
        throw new Error(tokenJson.error_description || tokenJson.error || "Failed to exchange Microsoft OAuth code.");
      }

      const idPayload = parseJwtPayload(tokenJson.id_token);
      verifiedEmail = normalizeEmail(idPayload?.preferred_username || idPayload?.email || idPayload?.upn || "");
      if (!verifiedEmail) {
        throw new Error("Unable to extract verified email from Microsoft ID token.");
      }
      userName = idPayload.name || "";
    } else {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    // RBAC Multi-Role Resolution
    const roles = await getUserRoles(env, verifiedEmail);

    // Determine target portal and check authorization
    let targetPortal = portal;
    let accessDenied = false;

    if (targetPortal === "report" && !roles.includes("report_viewer") && !roles.includes("admin") && !roles.includes("super_user")) {
      accessDenied = true;
    } else if (targetPortal === "admin" && !roles.includes("admin") && !roles.includes("super_user")) {
      accessDenied = true;
    } else if (targetPortal === "client" && !roles.includes("client")) {
      // Allow client portal self-onboarding or default to trainee
      targetPortal = "client";
    }

    // Issue session token containing full multi-role bundle
    const effectiveScope = accessDenied ? "trainee" : targetPortal;
    const sessionRes = await issueSessionToken(verifiedEmail, env, effectiveScope, roles);
    const expiresAt = sessionRes.expiresAt;

    // Log login event
    await appendAppLog(env, {
      event: `oauth_login_${provider}`,
      scope: effectiveScope,
      email: verifiedEmail,
      success: true,
      provider,
      detail: JSON.stringify({ roles, targetPortal, accessDenied, origin }),
      request
    });

    // Map portal destination URL
    let destPath = "/trainee";
    if (accessDenied) {
      if (portal === "admin") {
        destPath = `/admin?access_denied=1&email=${encodeURIComponent(verifiedEmail)}`;
      } else if (portal === "report") {
        destPath = `/report.html?access_denied=1&email=${encodeURIComponent(verifiedEmail)}`;
      }
    } else {
      if (targetPortal === "client") destPath = "/client";
      else if (targetPortal === "report") destPath = "/report.html";
      else if (targetPortal === "admin") destPath = "/admin";
    }

    // Build landing HTML that sets localStorage and pd_session cookie, then redirects
    const finalRedirectUrl = `${origin}${destPath}`;
    const cookieVal = encodeURIComponent(sessionRes.token);

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authenticating...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
    .card { background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; max-width: 400px; }
    .spinner { border: 3px solid rgba(0, 48, 135, 0.1); border-top: 3px solid #003087; border-radius: 50%; width: 36px; height: 36px; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h3>Sign-in Successful</h3>
    <p style="font-size: 14px; color: #64748b;">Redirecting as <b>${verifiedEmail}</b>...</p>
  </div>
  <script>
    try {
      const email = ${JSON.stringify(verifiedEmail)};
      const token = ${JSON.stringify(sessionRes.token)};
      const expiresAt = ${JSON.stringify(expiresAt)};
      const roles = ${JSON.stringify(roles)};

      // 1. Admin Portal Keys (if authorized)
      if (roles.includes("admin") || roles.includes("super_user")) {
        localStorage.setItem("pdhub_admin_token", token);
        localStorage.setItem("pdhub_admin_exp", expiresAt);
        localStorage.setItem("pdhub_admin_email", email);
        localStorage.setItem("pdhub_admin_role", roles.includes("super_user") ? "super_user" : "admin");
      }

      // 2. Report Portal Keys (if authorized)
      if (roles.includes("report_viewer") || roles.includes("admin") || roles.includes("super_user")) {
        localStorage.setItem("pdhub_report_token", token);
        localStorage.setItem("pdhub_report_exp", expiresAt);
        localStorage.setItem("pdhub_report_email", email);
        localStorage.setItem("pdhub_report_role", roles.includes("super_user") ? "super_user" : roles.includes("admin") ? "admin" : "report_viewer");
      }

      // 3. Trainee Portal Keys (Available for all signed in users)
      localStorage.setItem("pdc_trainee_token", token);
      localStorage.setItem("pdc_email", email);

      // 4. Corporate Client Portal Keys (if authorized)
      if (roles.includes("client")) {
        localStorage.setItem("pdhub_session_token", token);
        localStorage.setItem("pdhub_session_email", email);
        localStorage.setItem("pdhub_session_time", Date.now().toString());
        localStorage.setItem("pdhub_session_expires_at", expiresAt);
      }

      // 5. Unified & Legacy Keys
      localStorage.setItem("userEmail", email);
      localStorage.setItem("traineeEmail", email);
      localStorage.setItem("clientEmail", email);
      localStorage.setItem("adminEmail", email);
      localStorage.setItem("adminSessionToken", token);
      localStorage.setItem("sessionToken", token);
      localStorage.setItem("userRoles", JSON.stringify(roles));

      // Also set cookie for cross-portal sharing
      document.cookie = "pd_session=" + encodeURIComponent(token) + "; path=/; max-age=28800; SameSite=Lax; Secure";
      document.cookie = "pd_user=" + encodeURIComponent(email) + "; path=/; max-age=28800; SameSite=Lax; Secure";
    } catch(e) {
      console.error(e);
    }
    window.location.replace(${JSON.stringify(finalRedirectUrl)});
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": `pd_session=${cookieVal}; Path=/; Max-Age=28800; SameSite=Lax; Secure`
      }
    });
  } catch (err) {
    await appendAppLog(env, {
      event: `oauth_login_error`,
      scope: "auth",
      email: verifiedEmail || "unknown",
      success: false,
      provider,
      detail: err.message || String(err),
      request
    });

    return new Response(`<h3>Authentication Failed</h3><p style="color:#dc2626;">${err.message || String(err)}</p><p><a href="/">Return to Home</a></p>`, {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
}
