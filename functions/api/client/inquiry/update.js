import { assertEmailAllowed, jsonResponse, normalizeEmail, readJson, requireClientSession } from "../../../_lib/security.js";
import { batchUpdateSheetValues, getCoreSpreadsheetId, getSheetValues, makeCellRange, quoteSheetName } from "../../../_lib/google-sheets.js";
import { getTableSheetName } from "../../../_lib/data-source.js";
import { isPsql, nowVietnamLocal } from "../../../_lib/repos/repo-utils.js";
import { getClientInquiryPsql, updateClientInquiryPsql } from "../../../_lib/repos/client-repo.js";

const TBL_INQUIRY = "pdc-inquiry management";
const SYSTEM_EXCLUDE_COLUMNS = new Set([
  "inquiry id",
  "client id",
  "bd incharge",
  "inquiry created datetime",
  "inquiry status",
  "inquiry completed datetime",
  "inquiry completed by",
  "client representative",
  "client representative name",
  "client representative email",
  "internal requester"
]);

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireClientSession(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const formData = parsed.data;
  const inquiryId = String(formData["inquiry id"] || "").trim();
  if (!inquiryId) {
    return jsonResponse({ success: false, error: "Missing required field: inquiry id" }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return handleMockUpdate(formData, auth.session, dbMode);
  }

  if (isPsql(env, "CLIENT_INQUIRY")) {
    try {
      const inquiry = await getClientInquiryPsql(env, inquiryId);
      if (!inquiry) {
        return jsonResponse({ success: false, source: "psql", error: "Không tìm thấy Inquiry ID này." }, 404);
      }

      const representativeEmail = normalizeEmail(inquiry["client representative email"] || inquiry["client_representative_email"] || "");
      const internalRequester = normalizeEmail(inquiry["internal requester"] || inquiry["internal_requester"] || "");
      const sessionEmail = normalizeEmail(auth.session.email);

      if (representativeEmail !== sessionEmail && internalRequester !== sessionEmail) {
        return jsonResponse({
          success: false,
          error: "Forbidden. This inquiry does not belong to the authenticated session."
        }, 403);
      }

      const updates = {};
      const updatedFields = [];

      for (const [rawKey, rawValue] of Object.entries(formData)) {
        const key = String(rawKey || "").toLowerCase().trim();
        if (!key || SYSTEM_EXCLUDE_COLUMNS.has(key)) continue;
        updates[key] = rawValue ?? "";
        updatedFields.push(key);
      }

      const now = formatVietnamDateTime(new Date());
      updates["inquiry status"] = "Client updated";
      updates["inquiry completed datetime"] = now;
      updates["inquiry completed by"] = sessionEmail;
      
      updatedFields.push("inquiry status", "inquiry completed datetime", "inquiry completed by");

      const dryRun = isTruthy(formData.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
      if (!dryRun) {
        await updateClientInquiryPsql(env, inquiryId, updates);
      }

      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        message: dryRun ? "Dry run OK. No data was written." : "Đã cập nhật thông tin nhu cầu đào tạo thành công!",
        receivedInquiryId: inquiryId,
        updatedFields: [...new Set(updatedFields)],
        updatedCellCount: updatedFields.length,
        googleUpdatedCells: dryRun ? 0 : 1
      });
    } catch (err) {
      return jsonResponse({
        success: false,
        source: "psql",
        error: err?.message || String(err)
      }, 500);
    }
  }

  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

    const range = `${quoteSheetName(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY)}!A:ZZ`;
    const result = await getSheetValues(env, spreadsheetId, range, { bypassCache: true });
    const values = Array.isArray(result.values) ? result.values : [];
    if (values.length < 2) throw new Error(`Sheet '${TBL_INQUIRY}' has no data rows.`);

    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const inquiryIdIdx = headers.indexOf("inquiry id");
    if (inquiryIdIdx === -1) throw new Error("Missing 'inquiry id' column in inquiry sheet.");

    const rowArrayIndex = values.findIndex((row, index) => index > 0 && String(row[inquiryIdIdx] || "").trim() === inquiryId);
    if (rowArrayIndex === -1) {
      return jsonResponse({ success: false, source: "gsheet", error: "Không tìm thấy Inquiry ID này." }, 404);
    }

    const targetRow = values[rowArrayIndex] || [];
    const sheetRowNumber = rowArrayIndex + 1;

    const representativeEmailIdx = headers.indexOf("client representative email");
    const internalRequesterIdx = headers.indexOf("internal requester");
    const representativeEmail = representativeEmailIdx >= 0 ? normalizeEmail(targetRow[representativeEmailIdx]) : "";
    const internalRequester = internalRequesterIdx >= 0 ? normalizeEmail(targetRow[internalRequesterIdx]) : "";
    const sessionEmail = normalizeEmail(auth.session.email);

    if (representativeEmail !== sessionEmail && internalRequester !== sessionEmail) {
      return jsonResponse({
        success: false,
        error: "Forbidden. This inquiry does not belong to the authenticated session."
      }, 403);
    }

    const updates = [];
    const updatedFields = [];

    for (const [rawKey, rawValue] of Object.entries(formData)) {
      const key = String(rawKey || "").toLowerCase().trim();
      if (!key || SYSTEM_EXCLUDE_COLUMNS.has(key)) continue;

      const colIndex = headers.indexOf(key);
      if (colIndex === -1) continue;

      updates.push({
        range: makeCellRange(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY, sheetRowNumber, colIndex + 1),
        values: [[rawValue ?? ""]]
      });
      updatedFields.push(key);
    }

    const now = formatVietnamDateTime(new Date());
    const statusIdx = headers.indexOf("inquiry status");
    const completedTimeIdx = headers.indexOf("inquiry completed datetime");
    const completedByIdx = headers.indexOf("inquiry completed by");

    if (statusIdx !== -1) {
      updates.push({ range: makeCellRange(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY, sheetRowNumber, statusIdx + 1), values: [["Client updated"]] });
      updatedFields.push("inquiry status");
    }
    if (completedTimeIdx !== -1) {
      updates.push({ range: makeCellRange(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY, sheetRowNumber, completedTimeIdx + 1), values: [[now]] });
      updatedFields.push("inquiry completed datetime");
    }
    if (completedByIdx !== -1) {
      updates.push({ range: makeCellRange(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY, sheetRowNumber, completedByIdx + 1), values: [[sessionEmail]] });
      updatedFields.push("inquiry completed by");
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
      message: dryRun ? "Dry run OK. No data was written." : "Đã cập nhật thông tin nhu cầu đào tạo thành công!",
      receivedInquiryId: inquiryId,
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
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/client/inquiry/update" }, 405);
}

function handleMockUpdate(formData, session, dbMode) {
  const inquiryId = String(formData["inquiry id"] || "").trim();
  const emailCheck = assertEmailAllowed(
    formData["client representative email"] || formData["internal requester"] || session.email,
    session.email
  );
  if (!emailCheck.ok) return emailCheck.response;

  const now = nowVietnamLocal();
  const updater = normalizeEmail(session.email);
  const simulatedRecord = {
    ...formData,
    "client representative email": formData["client representative email"] || updater,
    "inquiry status": "Client updated",
    "inquiry completed datetime": now,
    "inquiry completed by": updater
  };

  return jsonResponse({
    success: true,
    source: "mock",
    dbMode,
    authenticatedEmail: session.email,
    message: "Đã cập nhật thông tin nhu cầu đào tạo thành công!",
    receivedInquiryId: inquiryId,
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
