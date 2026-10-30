/**
 * /api/admin/roles
 * GET    — list all role assignments
 * POST   — assign/update role { email, role }
 * DELETE — remove role { email }
 *
 * Caller must be: in ADMIN_EMAILS env OR have role="admin" in pdc_user_roles sheet.
 */

import { jsonResponse, normalizeEmail, readJson, requireAdminSession, isAdminEmail } from "../../_lib/security.js";
import { getUserRoles, isSuperUser, listUserRoles, setUserRoles, deleteUserRole, VALID_ROLES } from "../../_lib/user-roles.js";
import { appendAppLog } from "../../_lib/app-logs.js";

async function isAuthorizedRoleManager(request, env) {
  // Must have a valid admin session first
  const adminAuth = await requireAdminSession(request, env);
  if (!adminAuth.ok) return { ok: false, response: adminAuth.response };

  const email = adminAuth.session.email;

  // Allow: in ADMIN_EMAILS env or has super_user role
  if (isAdminEmail(email, env) || await isSuperUser(env, email)) {
    return { ok: true, email };
  }

  return {
    ok: false,
    response: jsonResponse({ success: false, error: "Forbidden. You need Super User role to manage roles." }, 403)
  };
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await isAuthorizedRoleManager(context.request, env);
  if (!auth.ok) return auth.response;

  try {
    const roles = await listUserRoles(env);
    return jsonResponse({ success: true, data: roles });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await isAuthorizedRoleManager(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const targetEmail = normalizeEmail(parsed.data.email);
  if (!targetEmail) return jsonResponse({ success: false, error: "Missing 'email' field." }, 400);

  // Support both single role and multi-role array
  let rolesToSet = [];
  if (Array.isArray(parsed.data.roles) && parsed.data.roles.length > 0) {
    rolesToSet = parsed.data.roles.map(r => String(r || "").trim().toLowerCase());
  } else if (parsed.data.role) {
    rolesToSet = [String(parsed.data.role || "").trim().toLowerCase()];
  }

  // Validate roles
  const validSet = rolesToSet.filter(r => VALID_ROLES.includes(r));
  if (validSet.length === 0) {
    return jsonResponse({ success: false, error: `Invalid roles. Allowed roles: ${VALID_ROLES.join(", ")}` }, 400);
  }

  const companyId = parsed.data.companyId || parsed.data.company_id || "";
  const companyName = parsed.data.companyName || parsed.data.company_name || "";
  const clientScope = parsed.data.clientScope || parsed.data.client_scope || null;

  try {
    const result = await setUserRoles(env, targetEmail, validSet, auth.email, { companyId, companyName, clientScope });
    await appendAppLog(env, {
      event: "admin_role_assign",
      scope: "admin",
      email: auth.email,
      success: true,
      detail: JSON.stringify({ targetEmail, roles: validSet, companyId, companyName, clientScope }),
      request: context.request
    });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    await appendAppLog(env, { event: "admin_role_assign", scope: "admin", email: auth.email, success: false, detail: err.message || String(err), request: context.request });
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}

export async function onRequestDelete(context) {
  const env = context.env || {};
  const auth = await isAuthorizedRoleManager(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const targetEmail = normalizeEmail(parsed.data.email);
  if (!targetEmail) return jsonResponse({ success: false, error: "Missing 'email' field." }, 400);

  try {
    const result = await deleteUserRole(env, targetEmail);
    await appendAppLog(env, { event: "admin_role_delete", scope: "admin", email: auth.email, success: true, detail: JSON.stringify({ targetEmail }), request: context.request });
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    await appendAppLog(env, { event: "admin_role_delete", scope: "admin", email: auth.email, success: false, detail: err.message || String(err), request: context.request });
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}
