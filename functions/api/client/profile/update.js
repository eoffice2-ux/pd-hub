import { assertEmailAllowed, jsonResponse, normalizeEmail, readJson, requireClientSession } from "../../../_lib/security.js";
import { batchUpdateSheetValues, getCoreSpreadsheetId, getSheetValues, makeCellRange, quoteSheetName } from "../../../_lib/google-sheets.js";
import { getTableSheetName } from "../../../_lib/data-source.js";
import { nowVietnamLocal } from "../../../_lib/repos/repo-utils.js";

const TBL_CLIENT_CONTRACT = "pdc_client_contract_info";
const SYSTEM_EXCLUDE_COLUMNS = new Set([
  "client id",
  "client updater email",
  "updated at",
  "updated by"
]);

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireClientSession(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const formData = parsed.data;
  const clientId = String(formData["client id"] || "").trim();
  if (!clientId) {
    return jsonResponse({ success: false, error: "Missing required field: client id" }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return handleMockUpdate(formData, auth.session, dbMode);
  }

  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

    const range = `${quoteSheetName(getTableSheetName(env, "CLIENT_PROFILE") || TBL_CLIENT_CONTRACT)}!A:ZZ`;
    const result = await getSheetValues(env, spreadsheetId, range, { bypassCache: true });
    const values = Array.isArray(result.values) ? result.values : [];
    if (values.length < 2) throw new Error(`Sheet '${TBL_CLIENT_CONTRACT}' has no data rows.`);

    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const clientIdIdx = headers.indexOf("client id");
    const updaterEmailIdx = headers.indexOf("client updater email");

    if (clientIdIdx === -1) throw new Error("Missing 'client id' column in client contract sheet.");
    if (updaterEmailIdx === -1) throw new Error("Missing 'client updater email' column in client contract sheet.");

    const rowArrayIndex = values.findIndex((row, index) => index > 0 && String(row[clientIdIdx] || "").trim() === clientId);
    if (rowArrayIndex === -1) {
      return jsonResponse({ success: false, source: "gsheet", error: "Không tìm thấy client id này." }, 404);
    }

    const targetRow = values[rowArrayIndex] || [];
    const sheetRowNumber = rowArrayIndex + 1;
    const rowUpdaterEmail = normalizeEmail(targetRow[updaterEmailIdx]);
    const sessionEmail = normalizeEmail(auth.session.email);

    if (rowUpdaterEmail !== sessionEmail) {
      return jsonResponse({
        success: false,
        error: "Forbidden. This client profile does not belong to the authenticated session."
      }, 403);
    }

    // If the frontend sends client updater email, it must match the authenticated session.
    // The value is never written, but this catches tampering and bad client state early.
    const emailCheck = assertEmailAllowed(formData["client updater email"] || sessionEmail, sessionEmail);
    if (!emailCheck.ok) return emailCheck.response;

    const updates = [];
    const updatedFields = [];

    for (const [rawKey, rawValue] of Object.entries(formData)) {
      const key = String(rawKey || "").toLowerCase().trim();
      if (!key || key.startsWith("__") || SYSTEM_EXCLUDE_COLUMNS.has(key)) continue;

      const colIndex = headers.indexOf(key);
      if (colIndex === -1) continue;

      updates.push({
        range: makeCellRange(getTableSheetName(env, "CLIENT_PROFILE") || TBL_CLIENT_CONTRACT, sheetRowNumber, colIndex + 1),
        values: [[rawValue ?? ""]]
      });
      updatedFields.push(key);
    }

    const now = formatVietnamDateTime(new Date());
    const updatedAtIdx = headers.indexOf("updated at");
    const updatedByIdx = headers.indexOf("updated by");

    if (updatedAtIdx !== -1) {
      updates.push({ range: makeCellRange(getTableSheetName(env, "CLIENT_PROFILE") || TBL_CLIENT_CONTRACT, sheetRowNumber, updatedAtIdx + 1), values: [[now]] });
      updatedFields.push("updated at");
    }
    if (updatedByIdx !== -1) {
      updates.push({ range: makeCellRange(getTableSheetName(env, "CLIENT_PROFILE") || TBL_CLIENT_CONTRACT, sheetRowNumber, updatedByIdx + 1), values: [[sessionEmail]] });
      updatedFields.push("updated by");
    }

    if (updates.length === 0) {
      return jsonResponse({ success: false, source: "gsheet", error: "No matching editable columns found to update." }, 400);
    }

    const dryRun = isTruthy(formData.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
    let googleResult = null;
    if (!dryRun) {
      googleResult = await batchUpdateSheetValues(env, spreadsheetId, updates);
    }

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      message: dryRun ? "Dry run OK. No data was written." : "Cập nhật thành công!",
      receivedClientId: clientId,
      row: sheetRowNumber,
      updatedFields: [...new Set(updatedFields)],
      updatedCellCount: updates.length,
      googleUpdatedCells: googleResult?.totalUpdatedCells ?? 0
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      source: "gsheet",
      error: err?.message || String(err)
    }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/client/profile/update" }, 405);
}

function handleMockUpdate(formData, session, dbMode) {
  const clientId = String(formData["client id"] || "").trim();
  const emailCheck = assertEmailAllowed(
    formData["client updater email"] || session.email,
    session.email
  );
  if (!emailCheck.ok) return emailCheck.response;

  const now = nowVietnamLocal();
  const updater = normalizeEmail(session.email);
  const simulatedRecord = {
    ...formData,
    "client updater email": formData["client updater email"] || updater,
    "updated at": now,
    "updated by": updater
  };

  return jsonResponse({
    success: true,
    source: "mock",
    dbMode,
    authenticatedEmail: session.email,
    message: "Cập nhật thành công!",
    receivedClientId: clientId,
    data: simulatedRecord
  });
}

function formatVietnamDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function isTruthy(value) {
  const v = String(value || "").toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}
