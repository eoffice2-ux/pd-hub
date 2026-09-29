import { jsonResponse, requireAdminOrDebug, requireAdminSession } from "../../_lib/security.js";
import { getUserRole } from "../../_lib/user-roles.js";
import { listPendingOrgs } from "../../_lib/repos/pending-org-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  // Same auth pattern as status.js
  let adminAuth = await requireAdminOrDebug(request, env);
  if (!adminAuth.ok) {
    const sessionAuth = await requireAdminSession(request, env);
    if (sessionAuth.ok) {
      const role = await getUserRole(env, sessionAuth.session.email);
      if (role === "admin") {
        adminAuth = { ok: true, method: "admin-session", session: sessionAuth.session };
      }
    }
  }
  if (!adminAuth.ok) return adminAuth.response;

  const url = new URL(request.url);
  const sort  = String(url.searchParams.get("sort")  || "created_at");
  const order = String(url.searchParams.get("order") || "desc");

  try {
    const rows = await listPendingOrgs(env, { sort, order });
    return jsonResponse({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: "Failed to load pending organizations: " + (err?.message || String(err))
    }, 500);
  }
}
