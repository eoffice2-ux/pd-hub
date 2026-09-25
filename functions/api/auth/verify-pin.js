import { jsonResponse, normalizeEmail, isAdminEmail, issueSessionToken } from "../../_lib/security.js";
import { getUserInfo } from "../../_lib/user-roles.js";

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
    if (!isMockPinOk) {
      return jsonResponse({ success: true, source: "mock", data: { ok: false } });
    }
    const scope = portal === "client" ? "client" : "admin";
    const session = await issueSessionToken(email, env, scope);
    const role = portal === "client" ? "client" : (email.includes("viewer") ? "report_viewer" : "admin");
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
    const sheetRole = userInfo ? userInfo.role : null;
    const realPin = userInfo ? userInfo.pin : "";

    let authorized = false;
    let resolvedRole = sheetRole;

    if (portal === "client") {
      authorized = true;
      resolvedRole = sheetRole || "client";
    } else if (portal === "admin") {
      authorized = isEnvAdmin || sheetRole === "admin";
      resolvedRole = sheetRole || "admin";
    } else if (portal === "report") {
      authorized = isEnvAdmin || sheetRole === "admin" || sheetRole === "report_viewer";
      resolvedRole = sheetRole || "admin";
    } else {
      return jsonResponse({ success: false, error: "Invalid portal parameter." }, 400);
    }

    if (!authorized) {
      return jsonResponse({ success: false, error: `This email is not authorized for ${portal} access.` }, 403);
    }

    const ok = realPin !== "" && realPin === pin;
    if (!ok) {
      return jsonResponse({ success: true, source: "gsheet", dbMode, data: { ok: false } });
    }

    const scope = portal === "client" ? "client" : "admin";
    const session = await issueSessionToken(email, env, scope);

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      data: {
        ok: true,
        email,
        scope,
        role: resolvedRole,
        token: session.token,
        expiresAt: session.expiresAt,
        expiresInSeconds: session.expiresInSeconds
      }
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
