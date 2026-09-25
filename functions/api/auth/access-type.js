import { jsonResponse, normalizeEmail, isAdminEmail } from "../../_lib/security.js";
import { getUserInfo } from "../../_lib/user-roles.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const email = normalizeEmail(url.searchParams.get("email") || "");
  const portal = String(url.searchParams.get("portal") || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  // Handle Mock Mode
  if (dbMode === "mock") {
    const isNewUser = email.includes("new") || email.includes("otp");
    let authorized = true;
    if (portal === "admin" || portal === "report") {
      // In mock mode, only deny specific emails to simulate forbidden
      if (email.includes("forbidden") || email.includes("client")) {
        authorized = false;
      }
    }
    if (!authorized) {
      return jsonResponse({ success: false, error: `This email is not authorized for ${portal} access.` }, 403);
    }
    return jsonResponse({
      success: true,
      source: "mock",
      requestedEmail: email,
      data: {
        exists: true,
        hasPin: !isNewUser
      }
    });
  }

  try {
    const userInfo = await getUserInfo(env, email);
    const isEnvAdmin = isAdminEmail(email, env);
    const sheetRole = userInfo ? userInfo.role : null;
    const hasPin = userInfo && userInfo.pin ? true : false;

    let authorized = false;

    if (portal === "client") {
      authorized = true;
    } else if (portal === "admin") {
      authorized = isEnvAdmin || sheetRole === "admin";
    } else if (portal === "report") {
      authorized = isEnvAdmin || sheetRole === "admin" || sheetRole === "report_viewer";
    } else {
      return jsonResponse({ success: false, error: "Invalid portal parameter." }, 400);
    }

    if (!authorized) {
      return jsonResponse({ success: false, error: `This email is not authorized for ${portal} access.` }, 403);
    }

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      requestedEmail: email,
      data: {
        exists: true,
        hasPin
      }
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
