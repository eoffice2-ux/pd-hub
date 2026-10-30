import { jsonResponse, normalizeEmail, isAdminEmail } from "../../_lib/security.js";
import { getUserInfo, getUserRoles } from "../../_lib/user-roles.js";

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
    const roles = await getUserRoles(env, email);
    const hasPin = userInfo && userInfo.pin ? true : false;

    let authorized = false;

    if (portal === "client") {
      authorized = isEnvAdmin || roles.includes("super_user") || roles.includes("admin") || roles.includes("client");
    } else if (portal === "admin") {
      authorized = isEnvAdmin || roles.includes("super_user") || roles.includes("admin");
    } else if (portal === "report") {
      authorized = isEnvAdmin || roles.includes("super_user") || roles.includes("admin") || roles.includes("report_viewer");
    } else {
      return jsonResponse({ success: false, error: "Invalid portal parameter." }, 400);
    }

    if (!authorized) {
      const portalLabel = portal === "client" ? "Cổng Doanh nghiệp (Client Portal)" : portal;
      return jsonResponse({
        success: false,
        error: `Tài khoản email này chưa được cấp quyền truy cập ${portalLabel}. Vui lòng liên hệ PD Team để được hỗ trợ. / This email is not authorized for ${portal} access.`
      }, 403);
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
