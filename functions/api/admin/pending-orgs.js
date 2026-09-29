import { jsonResponse, requireAdminOrDebug, requireAdminSession } from "../../_lib/security.js";
import { getUserRole } from "../../_lib/user-roles.js";
import { listPendingOrgs, updatePendingOrg } from "../../_lib/repos/pending-org-repo.js";
import { queryPostgres } from "../../_lib/postgres.js";

async function verifyAdminAuth(request, env) {
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
  return adminAuth;
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  const adminAuth = await verifyAdminAuth(request, env);
  if (!adminAuth.ok) return adminAuth.response;

  // Safety migration: ensure name_en column exists
  try {
    await queryPostgres(env, `ALTER TABLE public.pdc_pending_organizations ADD COLUMN IF NOT EXISTS "name_en" TEXT`, []);
  } catch (mErr) {
    console.warn("Safety migration warning (name_en):", mErr?.message || mErr);
  }

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

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  const adminAuth = await verifyAdminAuth(request, env);
  if (!adminAuth.ok) return adminAuth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const pd_id = String(body.pd_id || "").trim();
    const name = String(body.name || "").trim();
    const name_en = String(body.name_en || "").trim();
    let status = String(body.status || "pending").trim().toLowerCase();

    if (!pd_id) {
      return jsonResponse({ success: false, error: "Missing required field: pd_id" }, 400);
    }
    if (!name) {
      return jsonResponse({ success: false, error: "Company VN name cannot be empty" }, 400);
    }

    if (status === "unverified") status = "pending";
    const allowedStatuses = new Set(["pending", "verified", "removed"]);
    if (!allowedStatuses.has(status)) {
      return jsonResponse({ success: false, error: "Invalid status: " + status }, 400);
    }

    const updated = await updatePendingOrg(env, { pd_id, name, name_en, status });
    if (!updated) {
      return jsonResponse({ success: false, error: "Organization not found" }, 404);
    }

    return jsonResponse({ success: true, message: "Organization updated successfully", data: updated });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: "Failed to update pending organization: " + (err?.message || String(err))
    }, 500);
  }
}
