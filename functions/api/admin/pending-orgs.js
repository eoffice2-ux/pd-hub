import { jsonResponse, requireAdminOrDebug, requireAdminSession } from "../../_lib/security.js";
import { getUserRole } from "../../_lib/user-roles.js";
import { listPendingOrgs, updatePendingOrg, listAllUsedTraineeOrgs, batchReassignTraineesOrganization } from "../../_lib/repos/pending-org-repo.js";
import { queryPostgres } from "../../_lib/postgres.js";
import { appendAppLog } from "../../_lib/app-logs.js";

async function verifyAdminAuth(request, env) {
  let adminAuth = await requireAdminOrDebug(request, env);
  if (!adminAuth.ok) {
    const sessionAuth = await requireAdminSession(request, env);
    if (sessionAuth.ok) {
      const role = await getUserRole(env, sessionAuth.session.email);
      if (role === "admin" || role === "super_user") {
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
  const view = String(url.searchParams.get("view") || "").toLowerCase().trim();
  const searchOce = String(url.searchParams.get("search_oce") || "").trim();

  // Search official companies in oce_industry_list for autocomplete
  if (searchOce) {
    try {
      const q = `%${searchOce.toLowerCase()}%`;
      const res = await queryPostgres(env, `
        SELECT company_id, company_name_vn, company_name_en, tax_code
        FROM public.oce_industry_list
        WHERE LOWER(TRIM(company_id)) LIKE $1
           OR LOWER(TRIM(company_name_vn)) LIKE $1
           OR LOWER(TRIM(company_name_en)) LIKE $1
           OR LOWER(TRIM(tax_code)) LIKE $1
        ORDER BY company_name_vn ASC
        LIMIT 25
      `, [q]);
      return jsonResponse({ success: true, count: res.rows?.length || 0, data: res.rows || [] });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message || String(err) }, 500);
    }
  }

  // View: all company IDs used by trainees in pdc_trainee general profile
  if (view === "trainee_orgs" || view === "used_orgs") {
    const search = String(url.searchParams.get("search") || "").trim();
    try {
      const rows = await listAllUsedTraineeOrgs(env, { search });
      return jsonResponse({ success: true, count: rows.length, data: rows });
    } catch (err) {
      return jsonResponse({
        success: false,
        error: "Failed to load trainee organizations: " + (err?.message || String(err))
      }, 500);
    }
  }

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
    const action = String(body.action || "").toLowerCase().trim();

    // 1. Batch Reassignment Action
    if (action === "batch_reassign") {
      const sourceOrgId = String(body.sourceOrgId || body.source_org_id || "").trim();
      const sourceOrgName = String(body.sourceOrgName || body.source_org_name || "").trim();
      const traineeEmails = Array.isArray(body.traineeEmails) ? body.traineeEmails : [];
      const targetCompanyId = String(body.targetCompanyId || body.target_company_id || "").trim();
      const targetCompanyName = String(body.targetCompanyName || body.target_company_name || "").trim();
      const pendingPdId = String(body.pendingPdId || body.pending_pd_id || "").trim();
      const markPendingVerified = body.markPendingVerified !== false;

      if (!targetCompanyId) {
        return jsonResponse({ success: false, error: "Missing targetCompanyId." }, 400);
      }

      const result = await batchReassignTraineesOrganization(env, {
        sourceOrgId,
        sourceOrgName,
        traineeEmails,
        targetCompanyId,
        targetCompanyName,
        pendingPdId,
        markPendingVerified,
        adminEmail: adminAuth.session?.email || "admin"
      });

      await appendAppLog(env, {
        event: "admin_org_batch_reassign",
        scope: "admin",
        email: adminAuth.session?.email || "admin",
        success: true,
        detail: JSON.stringify({
          sourceOrgId,
          targetCompanyId,
          updatedCount: result.updatedCount,
          traineeEmails
        }),
        request
      });

      return jsonResponse({
        success: true,
        message: `Successfully reassigned ${result.updatedCount} trainee(s) to ${result.targetCompanyName} (${result.targetCompanyId}).`,
        data: result
      });
    }

    // 2. Normal Pending Org Update Action
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

    await appendAppLog(env, { event: "admin_org_update", scope: "admin", email: adminAuth.session?.email || "admin", success: true, detail: JSON.stringify({ pd_id, name, name_en, status }), request });

    return jsonResponse({ success: true, message: "Organization updated successfully", data: updated });
  } catch (err) {
    await appendAppLog(env, { event: "admin_org_update", scope: "admin", email: adminAuth.session?.email || "admin", success: false, detail: err?.message || String(err), request });
    return jsonResponse({
      success: false,
      error: "Failed to update pending organization: " + (err?.message || String(err))
    }, 500);
  }
}
