import { jsonResponse, readJson, requireAdminOrDebug, requireAdminSession, isAdminEmail } from "../../_lib/security.js";
import { appendAppLog } from "../../_lib/app-logs.js";
import { getUserRole } from "../../_lib/user-roles.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  let viewerEmail = "";
  const debugAuth = await requireAdminOrDebug(request, env);
  if (debugAuth.ok) {
    viewerEmail = debugAuth.session?.email || "admin@debug";
  } else {
    const sessionAuth = await requireAdminSession(request, env);
    if (!sessionAuth.ok) return sessionAuth.response;
    const sessionRoles = Array.isArray(sessionAuth.session.roles) ? sessionAuth.session.roles : [sessionAuth.session.scope];
    const role = await getUserRole(env, sessionAuth.session.email);
    const isEnvAdmin = isAdminEmail(sessionAuth.session.email, env);
    const hasReportAccess = isEnvAdmin ||
                            sessionRoles.includes("super_user") ||
                            sessionRoles.includes("admin") ||
                            sessionRoles.includes("report_viewer") ||
                            role === "admin" ||
                            role === "super_user" ||
                            role === "report_viewer";
    if (!hasReportAccess) {
      return jsonResponse({ success: false, error: "Forbidden. Requires admin or report_viewer role." }, 403);
    }
    viewerEmail = sessionAuth.session.email;
  }

  const parsed = await readJson(request);
  if (!parsed.ok) {
    return jsonResponse({ success: false, error: parsed.error }, 400);
  }

  const data = parsed.data || {};
  const sectionId = String(data.sectionId || "").trim().slice(0, 80);
  const mappingId = String(data.mappingId || "").trim().slice(0, 80);
  const allowedActions = new Set(["show", "print", "csv_export"]);
  const rawAction = String(data.action || "show").trim().toLowerCase();
  const action = allowedActions.has(rawAction) ? rawAction : "show";

  if (!sectionId) {
    return jsonResponse({ success: false, error: "Missing sectionId." }, 400);
  }

  await appendAppLog(env, {
    event: "report_feedback_email_viewed",
    scope: "admin",
    email: viewerEmail,
    success: true,
    detail: JSON.stringify({ sectionId, mappingId, action }),
    request
  });

  return jsonResponse({ success: true });
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/report/log-email-view" }, 405);
}
