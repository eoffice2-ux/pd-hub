import { jsonResponse, normalizeEmail, isAdminEmail, issueSessionToken } from "../../_lib/security.js";
import { getUserInfo, getUserRoles } from "../../_lib/user-roles.js";
import { appendAppLog } from "../../_lib/app-logs.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  let body;
  try {
    body = await context.request.json();
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);
  }

  const email = normalizeEmail(body.email || "");
  const pin = String(body.pin || "").trim();
  const portal = String(body.portal || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }
  if (!/^\d{4}$/.test(pin)) {
    return jsonResponse({ success: false, error: "PIN must be 4 digits." }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  // Handle Mock Mode
  if (dbMode === "mock") {
    const isMockPinOk = pin === String(env.MOCK_PIN || "1234");
    const eventType = portal === "client" ? "client_login" : "admin_login";
    if (!isMockPinOk) {
      await appendAppLog(env, { event: eventType, scope: "auth", email, success: false, detail: "Invalid PIN (mock)", request: context.request });
      return jsonResponse({ success: true, source: "mock", data: { ok: false } });
    }
    const scope = portal === "client" ? "client" : "admin";
    const session = await issueSessionToken(email, env, scope);
    const role = portal === "client" ? "client" : (email.includes("viewer") ? "report_viewer" : "admin");
    await appendAppLog(env, { event: eventType, scope: "auth", email, success: true, detail: `PIN verified (mock). Role: ${role}`, request: context.request });
    return jsonResponse({
      success: true,
      source: "mock",
      data: {
        ok: true,
        email,
        scope,
        role,
        token: session.token,
        expiresAt: session.expiresAt,
        expiresInSeconds: session.expiresInSeconds
      }
    });
  }

  try {
    const userInfo = await getUserInfo(env, email);
    const isEnvAdmin = isAdminEmail(email, env);
    const roles = await getUserRoles(env, email);
    const realPin = userInfo ? userInfo.pin : "";

    let authorized = false;
    let resolvedRole = roles[0] || "client";
    let scope = "client";
    const eventType = portal === "client" ? "client_login" : "admin_login";

    if (portal === "client") {
      authorized = true;
      scope = "client";
      resolvedRole = roles.includes("client") ? "client" : roles[0];
    } else if (portal === "admin") {
      authorized = isEnvAdmin || roles.includes("super_user") || roles.includes("admin");
      scope = "admin";
      resolvedRole = roles.includes("super_user") ? "super_user" : "admin";
    } else if (portal === "report") {
      authorized = isEnvAdmin || roles.includes("super_user") || roles.includes("admin") || roles.includes("report_viewer");
      scope = (isEnvAdmin || roles.includes("super_user") || roles.includes("admin")) ? "admin" : "report_viewer";
      resolvedRole = roles.includes("super_user") ? "super_user" : (roles.includes("admin") ? "admin" : "report_viewer");
    } else {
      return jsonResponse({ success: false, error: "Invalid portal parameter." }, 400);
    }

    if (!authorized) {
      await appendAppLog(env, { event: eventType, scope: "auth", email, success: false, detail: `This email is not authorized for ${portal} access.`, request: context.request });
      return jsonResponse({ success: false, error: `This email is not authorized for ${portal} access.` }, 403);
    }

    const ok = realPin !== "" && realPin === pin;
    if (!ok) {
      await appendAppLog(env, { event: eventType, scope: "auth", email, success: false, detail: "Invalid PIN", request: context.request });
      return jsonResponse({ success: true, source: "gsheet", dbMode, data: { ok: false } });
    }

    const session = await issueSessionToken(email, env, scope, roles);
    await appendAppLog(env, { event: eventType, scope: "auth", email, success: true, detail: `PIN verified. Role: ${resolvedRole}`, request: context.request });

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      data: {
        ok: true,
        email,
        scope,
        role: resolvedRole,
        roles,
        token: session.token,
        expiresAt: session.expiresAt,
        expiresInSeconds: session.expiresInSeconds
      }
    });
  } catch (err) {
    const eventType = portal === "client" ? "client_login" : "admin_login";
    await appendAppLog(env, { event: eventType, scope: "auth", email, success: false, detail: err?.message || String(err), request: context.request });
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
