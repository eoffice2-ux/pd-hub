/**
 * user-roles.js
 * CRUD operations for the pdc_user_roles Google Sheet.
 * Sheet columns: email | role | assigned_by | assigned_at
 *
 * Valid roles: "admin", "report_viewer"
 * Fallback: if email not in sheet but is in ADMIN_EMAILS env -> treated as "admin"
 */

import { normalizeEmail } from "./security.js";
import {
  getCoreSpreadsheetId,
  getSheetValues,
  appendSheetValues,
  batchUpdateSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName
} from "./google-sheets.js";
import { getTableSheetName, getTableSource } from "./data-source.js";
import { queryPostgres } from "./postgres.js";

export const VALID_ROLES = ["admin", "super_user", "report_viewer", "client", "trainee"];
export const ROLE_PRIORITY = ["super_user", "admin", "report_viewer", "client", "trainee"];
const SHEET_HEADERS = ["email", "role", "assigned_by", "assigned_at", "pin number", "roles"];

function getRolesSheetName(env) {
  return getTableSheetName(env, "USER_ROLES") || "pdc_user_roles";
}

function formatVNDateTime(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Ensure the pdc_user_roles sheet exists with the correct header row.
 * If the sheet does not exist, create it using spreadsheets.batchUpdate.
 */
export async function ensureRolesSheetExists(env) {
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");
  const sheetName = getRolesSheetName(env);

  const meta = await getSpreadsheetMetadata(env, spreadsheetId);
  const existingSheet = (meta.sheets || []).find(
    (s) => String(s.properties?.title || "").toLowerCase() === sheetName.toLowerCase()
  );

  if (!existingSheet) {
    // Create sheet via batchUpdate
    const token = await _getToken(env);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `Failed to create sheet '${sheetName}': ${res.status}`);

    // Write header row
    await batchUpdateSheetValues(env, spreadsheetId, [
      { range: `${quoteSheetName(sheetName)}!A1:E1`, values: [SHEET_HEADERS] }
    ]);
    return { created: true, sheetName };
  }

  // Sheet exists - ensure header row
  try {
    const result = await getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A1:E1`);
    if (!result.values || result.values.length === 0) {
      await batchUpdateSheetValues(env, spreadsheetId, [
        { range: `${quoteSheetName(sheetName)}!A1:E1`, values: [SHEET_HEADERS] }
      ]);
    }
  } catch (_) { /* ignore */ }
  return { created: false, sheetName };
}

/**
 * Read all rows from pdc_user_roles.
 */
async function _readAll(env) {
  const spreadsheetId = getCoreSpreadsheetId(env);
  const sheetName = getRolesSheetName(env);
  let data;
  try {
    data = await getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:E`);
  } catch (_) {
    return [];
  }
  const values = data.values || [];
  if (values.length < 2) return [];

  const headers = values[0].map((h) => String(h || "").trim().toLowerCase());
  const emailIdx = headers.indexOf("email");
  const roleIdx = headers.indexOf("role");
  const assignedByIdx = headers.indexOf("assigned_by");
  const assignedAtIdx = headers.indexOf("assigned_at");
  const pinIdx = headers.indexOf("pin number") !== -1 ? headers.indexOf("pin number") : headers.indexOf("pin");

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const email = emailIdx !== -1 ? normalizeEmail(row[emailIdx]) : "";
    const role = roleIdx !== -1 ? String(row[roleIdx] || "").trim().toLowerCase() : "";
    if (!email) continue;
    rows.push({
      email,
      role,
      assignedBy: assignedByIdx !== -1 ? String(row[assignedByIdx] || "") : "",
      assignedAt: assignedAtIdx !== -1 ? String(row[assignedAtIdx] || "") : "",
      pin: pinIdx !== -1 ? String(row[pinIdx] || "") : "",
      rowIndex: i + 1 // 1-indexed (row 1 = header)
    });
  }
  return rows;
}

/**
 * Parse a roles field (string, comma-separated, or JSON) into a clean string array.
 */
export function parseRolesList(rawRoles, fallbackRole = "") {
  const set = new Set();
  if (Array.isArray(rawRoles)) {
    rawRoles.forEach(r => {
      const clean = String(r || "").trim().toLowerCase();
      if (VALID_ROLES.includes(clean)) set.add(clean);
    });
  } else if (typeof rawRoles === "string" && rawRoles.trim()) {
    const trimmed = rawRoles.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          parsed.forEach(r => {
            const clean = String(r || "").trim().toLowerCase();
            if (VALID_ROLES.includes(clean)) set.add(clean);
          });
        }
      } catch (_) {}
    }
    if (set.size === 0) {
      trimmed.split(/[;,]/).forEach(r => {
        const clean = String(r || "").trim().toLowerCase();
        if (VALID_ROLES.includes(clean)) set.add(clean);
      });
    }
  }

  if (fallbackRole) {
    const cleanFallback = String(fallbackRole).trim().toLowerCase();
    if (VALID_ROLES.includes(cleanFallback)) set.add(cleanFallback);
  }

  // Sort by defined privilege priority
  return Array.from(set).sort((a, b) => {
    const ia = ROLE_PRIORITY.indexOf(a);
    const ib = ROLE_PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * Check if caller is super_user or in ADMIN_EMAILS.
 */
export async function isSuperUser(env, email) {
  const clean = normalizeEmail(email);
  if (!clean) return false;
  const adminEmails = String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(/[;,\n]/)
    .map(normalizeEmail)
    .filter(Boolean);
  if (adminEmails.includes(clean)) return true;

  const roles = await getUserRoles(env, clean);
  return roles.includes("super_user");
}

/**
 * Get all effective roles for an email.
 * Returns array e.g. ["super_user", "admin", "report_viewer", "trainee"]
 */
export async function getUserRoles(env, email) {
  const clean = normalizeEmail(email);
  if (!clean) return [];

  const rolesSet = new Set();

  // 1. ADMIN_EMAILS env has super_user + admin + report_viewer
  const adminEmails = String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(/[;,\n]/)
    .map(normalizeEmail)
    .filter(Boolean);
  if (adminEmails.includes(clean)) {
    rolesSet.add("super_user");
    rolesSet.add("admin");
    rolesSet.add("report_viewer");
  }

  if (getTableSource(env, "USER_ROLES") === "psql") {
    try {
      const res = await queryPostgres(env, `
        SELECT *
        FROM public.pdc_user_roles 
        WHERE LOWER(TRIM("email")) = $1 
        LIMIT 1
      `, [clean]);
      const row = res.rows?.[0];
      if (row) {
        const parsed = parseRolesList(row.roles, row.role);
        parsed.forEach(r => rolesSet.add(r));
      }
    } catch (_) {
      // Table might not exist or connection issue
    }
  } else {
    try {
      const rows = await _readAll(env);
      const match = rows.find((r) => r.email === clean);
      if (match) {
        const parsed = parseRolesList(match.roles || match.role, match.role);
        parsed.forEach(r => rolesSet.add(r));
      }
    } catch (_) {}
  }

  // Trainee is default role for anyone who enters system or has profile
  if (rolesSet.size === 0) {
    rolesSet.add("trainee");
  }

  // If user does not yet have "client", check if registered in client profile
  if (!rolesSet.has("client") && clean) {
    try {
      if (getTableSource(env, "CLIENT_PROFILE") === "psql") {
        const clientRes = await queryPostgres(env, `
          SELECT "client id" FROM public.pdc_client_contract_info
          WHERE LOWER(TRIM("client updater email")) = $1
          LIMIT 1
        `, [clean]);
        if (clientRes.rows && clientRes.rows.length > 0) {
          rolesSet.add("client");
        }
      }
    } catch (_) {}
  }

  // If user has super_user, ensure admin is also active
  if (rolesSet.has("super_user")) {
    rolesSet.add("admin");
  }

  // Return sorted by priority
  return Array.from(rolesSet).sort((a, b) => {
    const ia = ROLE_PRIORITY.indexOf(a);
    const ib = ROLE_PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * Get primary role (for backward compatibility).
 */
export async function getUserRole(env, email) {
  const roles = await getUserRoles(env, email);
  if (roles.includes("super_user")) return "super_user";
  if (roles.includes("admin")) return "admin";
  if (roles.includes("report_viewer")) return "report_viewer";
  if (roles.includes("client")) return "client";
  if (roles.includes("trainee")) return "trainee";
  return null;
}

/**
 * List all role assignments with multi-role support.
 */
export async function listUserRoles(env) {
  if (getTableSource(env, "USER_ROLES") === "psql") {
    try {
      // Ensure roles column exists
      try {
        await queryPostgres(env, `ALTER TABLE public.pdc_user_roles ADD COLUMN IF NOT EXISTS "roles" TEXT`);
      } catch (_) {}

      const res = await queryPostgres(env, `
        SELECT "email", "role", "roles", "assigned_by" AS "assignedBy", "assigned_at" AS "assignedAt", "pin number" AS "pin"
        FROM public.pdc_user_roles
        ORDER BY "assigned_at" DESC
      `);
      return (res.rows || []).map((r, i) => {
        const roles = parseRolesList(r.roles, r.role);
        return {
          ...r,
          email: normalizeEmail(r.email),
          role: String(r.role || roles[0] || "").toLowerCase().trim(),
          roles: roles.length > 0 ? roles : [String(r.role || "").toLowerCase().trim()].filter(Boolean),
          assignedAt: r.assignedAt ? (typeof r.assignedAt === "string" ? r.assignedAt : new Date(r.assignedAt).toISOString()) : "",
          rowIndex: i + 1
        };
      });
    } catch (_) {
      return [];
    }
  }

  try {
    const rows = await _readAll(env);
    return rows.map(r => {
      const roles = parseRolesList(r.roles || r.role, r.role);
      return {
        ...r,
        roles: roles.length > 0 ? roles : [r.role].filter(Boolean)
      };
    });
  } catch (_) {
    return [];
  }
}

/**
 * Assign or update a set of roles for an email (upsert).
 */
export async function setUserRoles(env, targetEmail, rolesArray, callerEmail) {
  const target = normalizeEmail(targetEmail);
  const caller = normalizeEmail(callerEmail);
  const cleanRoles = parseRolesList(rolesArray);

  if (!target) throw new Error("Missing target email.");
  if (cleanRoles.length === 0) throw new Error("At least one valid role must be provided.");

  const primaryRole = cleanRoles[0] || "trainee";
  const rolesJson = JSON.stringify(cleanRoles);

  if (getTableSource(env, "USER_ROLES") === "psql") {
    try {
      await queryPostgres(env, `ALTER TABLE public.pdc_user_roles ADD COLUMN IF NOT EXISTS "roles" TEXT`);
    } catch (_) {}

    const checkSql = `SELECT "email" FROM public.pdc_user_roles WHERE LOWER(TRIM("email")) = $1 LIMIT 1`;
    const checkRes = await queryPostgres(env, checkSql, [target]);
    const isUpdate = (checkRes.rows?.length || 0) > 0;

    if (isUpdate) {
      await queryPostgres(env, `
        UPDATE public.pdc_user_roles
        SET "role" = $2, "roles" = $3, "assigned_by" = $4, "assigned_at" = NOW()
        WHERE LOWER(TRIM("email")) = $1
      `, [target, primaryRole, rolesJson, caller]);
    } else {
      await queryPostgres(env, `
        INSERT INTO public.pdc_user_roles ("email", "role", "roles", "assigned_by", "assigned_at")
        VALUES ($1, $2, $3, $4, NOW())
      `, [target, primaryRole, rolesJson, caller]);
    }
    return { action: isUpdate ? "updated" : "created", email: target, role: primaryRole, roles: cleanRoles };
  }

  await ensureRolesSheetExists(env);
  const spreadsheetId = getCoreSpreadsheetId(env);
  const sheetName = getRolesSheetName(env);
  const rows = await _readAll(env);
  const now = formatVNDateTime(new Date());
  const existing = rows.find((r) => r.email === target);

  if (existing) {
    await batchUpdateSheetValues(env, spreadsheetId, [{
      range: `${quoteSheetName(sheetName)}!A${existing.rowIndex}:F${existing.rowIndex}`,
      values: [[target, primaryRole, caller, now, existing.pin || "", cleanRoles.join(",")]]
    }]);
    return { action: "updated", email: target, role: primaryRole, roles: cleanRoles };
  } else {
    await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:F`, [
      [target, primaryRole, caller, now, "", cleanRoles.join(",")]
    ]);
    return { action: "created", email: target, role: primaryRole, roles: cleanRoles };
  }
}

/**
 * Assign or update single role for an email (upsert - preserves existing roles).
 */
export async function setUserRole(env, targetEmail, role, callerEmail) {
  const target = normalizeEmail(targetEmail);
  const cleanRole = String(role || "").trim().toLowerCase();
  if (!VALID_ROLES.includes(cleanRole)) {
    throw new Error(`Invalid role '${cleanRole}'. Must be one of: ${VALID_ROLES.join(", ")}`);
  }

  // Fetch current roles and append
  const currentRoles = await getUserRoles(env, target);
  const updatedSet = new Set(currentRoles);
  updatedSet.add(cleanRole);
  return setUserRoles(env, target, Array.from(updatedSet), callerEmail);
}

/**
 * Remove role for an email (clears the row).
 */
export async function deleteUserRole(env, targetEmail) {
  const target = normalizeEmail(targetEmail);
  if (!target) throw new Error("Missing target email.");

  if (getTableSource(env, "USER_ROLES") === "psql") {
    const res = await queryPostgres(env, `DELETE FROM public.pdc_user_roles WHERE LOWER(TRIM("email")) = $1`, [target]);
    if ((res.rowCount || 0) === 0) return { action: "not_found", email: target };
    return { action: "deleted", email: target };
  }

  const spreadsheetId = getCoreSpreadsheetId(env);
  const sheetName = getRolesSheetName(env);
  const rows = await _readAll(env);
  const existing = rows.find((r) => r.email === target);
  if (!existing) return { action: "not_found", email: target };

  await batchUpdateSheetValues(env, spreadsheetId, [{
    range: `${quoteSheetName(sheetName)}!A${existing.rowIndex}:D${existing.rowIndex}`,
    values: [["", "", "", ""]]
  }]);
  return { action: "deleted", email: target };
}

// ---------- Custom PIN helpers ----------

export async function getUserInfo(env, email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;

  if (getTableSource(env, "USER_ROLES") === "psql") {
    try {
      const res = await queryPostgres(env, `
        SELECT *
        FROM public.pdc_user_roles
        WHERE LOWER(TRIM("email")) = $1
        LIMIT 1
      `, [clean]);
      const r = res.rows?.[0];
      if (!r) return null;
      const roles = parseRolesList(r.roles, r.role);
      const pinVal = String(r["pin number"] || r.pin || "").trim();
      return {
        email: normalizeEmail(r.email),
        role: String(r.role || roles[0] || "").toLowerCase().trim(),
        roles,
        assignedBy: r.assigned_by || r.assignedBy || "",
        assignedAt: r.assigned_at ? String(r.assigned_at) : "",
        pin: pinVal
      };
    } catch (_) {
      return null;
    }
  }

  try {
    const rows = await _readAll(env);
    const found = rows.find((r) => r.email === clean);
    if (!found) return null;
    const roles = parseRolesList(found.roles || found.role, found.role);
    return {
      ...found,
      roles
    };
  } catch (_) {
    return null;
  }
}

export async function setUserPin(env, email, pin, defaultRole = "client") {
  const target = normalizeEmail(email);
  if (!target) throw new Error("Missing email.");
  if (!/^\d{4}$/.test(String(pin || ""))) throw new Error("PIN must be 4 digits.");

  if (getTableSource(env, "USER_ROLES") === "psql") {
    const checkRes = await queryPostgres(env, `SELECT * FROM public.pdc_user_roles WHERE LOWER(TRIM("email")) = $1 LIMIT 1`, [target]);
    const existing = checkRes.rows?.[0];
    const roleToUse = existing?.role || defaultRole;
    const rolesToUse = existing ? parseRolesList(existing.roles, roleToUse) : [roleToUse];

    if (existing) {
      await queryPostgres(env, `
        UPDATE public.pdc_user_roles
        SET "pin number" = $2, "assigned_at" = NOW()
        WHERE LOWER(TRIM("email")) = $1
      `, [target, String(pin)]);
    } else {
      await queryPostgres(env, `
        INSERT INTO public.pdc_user_roles ("email", "role", "roles", "assigned_by", "assigned_at", "pin number")
        VALUES ($1, $2, $3, 'self', NOW(), $4)
      `, [target, roleToUse, JSON.stringify(rolesToUse), String(pin)]);
    }
    return { action: existing ? "updated" : "created", email: target, role: roleToUse };
  }

  await ensureRolesSheetExists(env);

  const spreadsheetId = getCoreSpreadsheetId(env);
  const sheetName = getRolesSheetName(env);
  const rows = await _readAll(env);
  const now = formatVNDateTime(new Date());
  const existing = rows.find((r) => r.email === target);

  if (existing) {
    await batchUpdateSheetValues(env, spreadsheetId, [{
      range: `${quoteSheetName(sheetName)}!A${existing.rowIndex}:E${existing.rowIndex}`,
      values: [[target, existing.role || defaultRole, existing.assignedBy || "self", now, pin]]
    }]);
    return { action: "updated", email: target, role: existing.role || defaultRole };
  } else {
    await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:E`, [
      [target, defaultRole, "self", now, pin]
    ]);
    return { action: "created", email: target, role: defaultRole };
  }
}

// ---------- Minimal Google token (mirrors google-sheets.js private fn) ----------
async function _getToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => {
    const enc = new TextEncoder().encode(JSON.stringify(obj));
    let bin = ""; enc.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: String(env.GOOGLE_CLIENT_EMAIL || "").trim(),
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  })}`;

  let pem = String(env.GOOGLE_PRIVATE_KEY || "").trim();
  if (pem.startsWith('"')) { try { pem = JSON.parse(pem); } catch { pem = pem.slice(1, -1); } }
  pem = pem.replace(/\\n/g, "\n").replace(/\r/g, "\n").trim();
  let base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const rem = base64.length % 4; if (rem) base64 += "=".repeat(4 - rem);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const key = await crypto.subtle.importKey("pkcs8", bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  let sigBin = ""; new Uint8Array(sig).forEach((b) => (sigBin += String.fromCharCode(b)));
  const assertion = `${unsigned}.${btoa(sigBin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(json?.error_description || `Token failed: ${res.status}`);
  return json.access_token;
}
