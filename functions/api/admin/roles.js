/**
 * /api/admin/roles
 * GET    — list all role assignments
 * POST   — assign/update role { email, role }
 * DELETE — remove role { email }
 *
 * Caller must be: in ADMIN_EMAILS env OR have role="admin" in pdc_user_roles sheet.
 */

import { jsonResponse, normalizeEmail, readJson, requireAdminSession, isAdminEmail } from "../../_lib/security.js";
import { getUserRole, listUserRoles, setUserRole, deleteUserRole, VALID_ROLES } from "../../_lib/user-roles.js";

async function isAuthorizedRoleManager(request, env) {
  // Must have a valid admin session first
  const adminAuth = await requireAdminSession(request, env);
  if (!adminAuth.ok) return { ok: false, response: adminAuth.response };

  const email = adminAuth.session.email;

  // Allow: in ADMIN_EMAILS env
  if (isAdminEmail(email, env)) return { ok: true, email };

  // Allow: role=admin in sheet
  const role = await getUserRole(env, email);
  if (role === "admin") return { ok: true, email };

  return {
    ok: false,
    response: jsonResponse({ success: false, error: "Forbidden. You need admin role to manage roles." }, 403)
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
  const role = String(parsed.data.role || "").trim().toLowerCase();

  if (!targetEmail) return jsonResponse({ success: false, error: "Missing 'email' field." }, 400);
  if (!VALID_ROLES.includes(role)) {
    return jsonResponse({ success: false, error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, 400);
  }

  try {
    const result = await setUserRole(env, targetEmail, role, auth.email);
    return jsonResponse({ success: true, ...result });
  } catch (err) {
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
    return jsonResponse({ success: true, ...result });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}
