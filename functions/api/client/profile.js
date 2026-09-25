import { assertEmailAllowed, jsonResponse, normalizeEmail, requireClientSession } from "../../_lib/security.js";
import { getCoreSpreadsheetId, getSheetValues, quoteSheetName } from "../../_lib/google-sheets.js";
import { getTableSheetName } from "../../_lib/data-source.js";

const TBL_CLIENT_CONTRACT = "pdc_client_contract_info";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireClientSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const emailCheck = assertEmailAllowed(url.searchParams.get("email"), auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const email = normalizeEmail(emailCheck.email);
  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  if (dbMode === "mock") {
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: email,
      data: buildMockProfile(email)
    });
  }

  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

    const range = `${quoteSheetName(getTableSheetName(env, "CLIENT_PROFILE") || TBL_CLIENT_CONTRACT)}!A:ZZ`;
    const result = await getSheetValues(env, spreadsheetId, range);
    const values = Array.isArray(result.values) ? result.values : [];

    if (values.length === 0) {
      return jsonResponse({
        success: false,
        source: "gsheet",
        dbMode,
        error: `Sheet '${TBL_CLIENT_CONTRACT}' has no rows.`
      }, 404);
    }

    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const emailColIdx = headers.indexOf("client updater email");

    if (emailColIdx === -1) {
      return jsonResponse({
        success: false,
        source: "gsheet",
        error: "Missing 'client updater email' column in client contract sheet.",
        availableHeaders: headers.filter(Boolean)
      }, 500);
    }

    let profile = null;
    let matchedRowNumber = null;

    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] || [];
      const rowEmail = normalizeEmail(row[emailColIdx]);
      if (rowEmail === email) {
        const obj = {};
        headers.forEach((header, colIndex) => {
          if (header) obj[header] = row[colIndex] ?? "";
        });
        profile = obj;
        matchedRowNumber = rowIndex + 1;
        break;
      }
    }

    if (!profile) {
      return jsonResponse({
        success: false,
        source: "gsheet",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: email,
        code: "CLIENT_PROFILE_NOT_FOUND",
        error: "Client profile not found for this email. Please contact the PD Team if you believe you should have access.",
        detail: `No matching row for ${email} in '${TBL_CLIENT_CONTRACT}' column 'client updater email'.`
      }, 404);
    }

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: email,
      rowNumber: matchedRowNumber,
      data: profile
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      source: "gsheet",
      error: err?.message || String(err)
    }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ success: false, error: "Method not allowed. Use GET /api/client/profile" }, 405);
}

function buildMockProfile(email) {
  return {
    "client id": "CLIENT-DEMO-001",
    "client updater email": email,
    "client name vn": "Công ty TNHH Demo",
    "client name en": "Demo Company Limited",
    "client address vn": "Bình Dương, Việt Nam",
    "client address en": "Binh Duong, Viet Nam",
    "tax code": "0312345678",
    "client phone number": "0900000000",
    "representative name vn": "Nguyễn Văn Demo",
    "representative name en": "Demo Nguyen",
    "representative position vn": "Trưởng phòng Nhân sự",
    "representative position en": "HR Manager",
    "updated at": "",
    "updated by": ""
  };
}
