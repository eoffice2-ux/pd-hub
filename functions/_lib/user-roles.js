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
import { getTableSheetName } from "./data-source.js";

export const VALID_ROLES = ["admin", "report_viewer", "client"];
const SHEET_HEADERS = ["email", "role", "assigned_by", "assigned_at", "pin number"];

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
 * Get the role of a specific email. Returns "admin" | "report_viewer" | null
 */
export async function getUserRole(env, email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;
  try {
    const rows = await _readAll(env);
    const match = rows.find((r) => r.email === clean);
    if (!match) return null;
    return VALID_ROLES.includes(match.role) ? match.role : null;
  } catch (_) {
    return null;
  }
}

/**
 * List all role assignments.
 */
export async function listUserRoles(env) {
  try {
    const rows = await _readAll(env);
    return rows.filter((r) => VALID_ROLES.includes(r.role));
  } catch (_) {
    return [];
  }
}

/**
 * Assign or update role for an email (upsert).
 */
export async function setUserRole(env, targetEmail, role, callerEmail) {
  const target = normalizeEmail(targetEmail);
  const caller = normalizeEmail(callerEmail);
  const cleanRole = String(role || "").trim().toLowerCase();

  if (!target) throw new Error("Missing target email.");
  if (!VALID_ROLES.includes(cleanRole)) {
    throw new Error(`Invalid role '${cleanRole}'. Must be one of: ${VALID_ROLES.join(", ")}`);
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
      values: [[target, cleanRole, caller, now, existing.pin || ""]]
    }]);
    return { action: "updated", email: target, role: cleanRole };
  } else {
    await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:E`, [
      [target, cleanRole, caller, now, ""]
    ]);
    return { action: "created", email: target, role: cleanRole };
  }
}

/**
 * Remove role for an email (clears the row).
 */
export async function deleteUserRole(env, targetEmail) {
  const target = normalizeEmail(targetEmail);
  if (!target) throw new Error("Missing target email.");

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
  try {
    const rows = await _readAll(env);
    return rows.find((r) => r.email === clean) || null;
  } catch (_) {
    return null;
  }
}

export async function setUserPin(env, email, pin, defaultRole = "client") {
  const target = normalizeEmail(email);
  if (!target) throw new Error("Missing email.");
  if (!/^\d{4}$/.test(String(pin || ""))) throw new Error("PIN must be 4 digits.");

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
