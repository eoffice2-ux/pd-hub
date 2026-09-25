import { queryPostgres } from "../postgres.js";
import { getTableSource, getTablePsqlName, getTableSheetName, quoteIdentifierPath } from "../data-source.js";
import { getCoreSpreadsheetId, getSheetValues, appendSheetValues, batchUpdateSheetValues, getSpreadsheetMetadata, quoteSheetName } from "../google-sheets.js";
import { normalizeEmail } from "../security.js";
import { nowVietnamLocal } from "./repo-utils.js";

const SHEET_HEADERS = ["timestamp", "app", "user_email", "otp", "sending_service", "status", "detail"];

export async function logEmailAttempt(env, { app, userEmail, otp, sendingService, status, detail = "" }) {
  const timestamp = nowVietnamLocal();
  const cleanUserEmail = normalizeEmail(userEmail);

  if (getTableSource(env, "EMAIL_LOG") === "psql") {
    try {
      const psqlName = getTablePsqlName(env, "EMAIL_LOG") || "public.pdc_email_log";
      const tableName = quoteIdentifierPath(psqlName, "EMAIL_LOG table");
      
      // Ensure table exists
      await queryPostgres(env, `
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          app VARCHAR(50) NOT NULL,
          user_email VARCHAR(255) NOT NULL,
          otp VARCHAR(10) NOT NULL,
          sending_service VARCHAR(50) NOT NULL,
          status VARCHAR(50) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          detail TEXT
        )
      `);

      // Insert record
      await queryPostgres(env, `
        INSERT INTO ${tableName} (app, user_email, otp, sending_service, status, timestamp, detail)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [app, cleanUserEmail, otp, sendingService, status, timestamp, detail]);

      // Prune database to last 100 rows
      await queryPostgres(env, `
        DELETE FROM ${tableName}
        WHERE id NOT IN (
          SELECT id FROM ${tableName}
          ORDER BY timestamp DESC
          LIMIT 100
        )
      `);
      return { ok: true, source: "psql" };
    } catch (err) {
      // Don't throw to disrupt the primary OTP send flow
      console.error("Failed to log email to PostgreSQL:", err);
      return { ok: false, error: err.message };
    }
  } else {
    // Log to Google Sheets
    try {
      const spreadsheetId = getCoreSpreadsheetId(env);
      if (!spreadsheetId) return { ok: false, reason: "Missing GOOGLE_SHEET_ID_CORE." };
      const sheetName = getTableSheetName(env, "EMAIL_LOG") || "pdc_email_log";

      await ensureEmailLogSheetExists(env, spreadsheetId, sheetName);

      const row = [timestamp, app, cleanUserEmail, otp, sendingService, status, detail];
      await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:G`, [row], "USER_ENTERED");

      // Prune Google Sheet to keep last 100 rows (plus header)
      await pruneGSheetLogs(env, spreadsheetId, sheetName);

      return { ok: true, source: "gsheet" };
    } catch (err) {
      console.error("Failed to log email to Google Sheets:", err);
      return { ok: false, error: err.message };
    }
  }
}

async function ensureEmailLogSheetExists(env, spreadsheetId, sheetName) {
  try {
    const meta = await getSpreadsheetMetadata(env, spreadsheetId);
    const exists = (meta.sheets || []).some(
      (s) => String(s.properties?.title || "").toLowerCase() === sheetName.toLowerCase()
    );

    if (!exists) {
      // Add sheet
      const token = await getGoogleAccessTokenDirect(env);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] })
      });
      if (!res.ok) throw new Error(`Failed to create sheet '${sheetName}'`);
      
      // Write header
      await batchUpdateSheetValues(env, spreadsheetId, [
        { range: `${quoteSheetName(sheetName)}!A1:G1`, values: [SHEET_HEADERS] }
      ]);
    }
  } catch (err) {
    // If it fails, let it try writing directly
  }
}

async function pruneGSheetLogs(env, spreadsheetId, sheetName) {
  try {
    const data = await getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:G`);
    const values = data.values || [];
    // If we have more than 101 rows (1 header + 100 rows), we prune
    if (values.length > 101) {
      const recentRows = values.slice(values.length - 100);
      
      // Clear sheet range first (e.g. range A2:G)
      const token = await getGoogleAccessTokenDirect(env);
      const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetName)}!A2:G:clear`;
      await fetch(clearUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" }
      });

      // Write recent rows back
      await batchUpdateSheetValues(env, spreadsheetId, [
        { range: `${quoteSheetName(sheetName)}!A2:G${recentRows.length + 1}`, values: recentRows }
      ]);
    }
  } catch (err) {
    console.error("Failed to prune Google Sheet email logs:", err);
  }
}

// Minimal JWT Token helper to avoid circular dependencies in internal helper scripts
async function getGoogleAccessTokenDirect(env = {}) {
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

export async function getRecentEmailLogsPsql(env, limit = 50) {
  try {
    const psqlName = getTablePsqlName(env, "EMAIL_LOG") || "public.pdc_email_log";
    const tableName = quoteIdentifierPath(psqlName, "EMAIL_LOG table");
    const result = await queryPostgres(env, `SELECT * FROM ${tableName} ORDER BY timestamp DESC LIMIT $1`, [limit]);
    if (!result.ok) throw new Error(result.error);
    return { ok: true, rows: result.rows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
