import { assertEmailAllowed, jsonResponse, normalizeEmail, requireClientSession } from "../../_lib/security.js";
import { getCoreSpreadsheetId, getSheetValues, quoteSheetName } from "../../_lib/google-sheets.js";
import { getTableSheetName } from "../../_lib/data-source.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getClientInquiriesPsql } from "../../_lib/repos/client-repo.js";

const TBL_INQUIRY = "pdc-inquiry management";

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
    const data = buildMockInquiries(email);
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: email,
      count: data.length,
      data
    });
  }

  if (isPsql(env, "CLIENT_INQUIRY")) {
    try {
      const inquiries = await getClientInquiriesPsql(env, email);
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: email,
        count: inquiries.length,
        data: inquiries
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

    const range = `${quoteSheetName(getTableSheetName(env, "CLIENT_INQUIRY") || TBL_INQUIRY)}!A:ZZ`;
    const result = await getSheetValues(env, spreadsheetId, range);
    const values = Array.isArray(result.values) ? result.values : [];

    if (values.length === 0) {
      return jsonResponse({
        success: true,
        source: "gsheet",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: email,
        count: 0,
        data: [],
        warning: `Sheet '${TBL_INQUIRY}' has no rows.`
      });
    }

    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const representativeEmailIdx = headers.indexOf("client representative email");
    const internalRequesterIdx = headers.indexOf("internal requester");

    if (representativeEmailIdx === -1 && internalRequesterIdx === -1) {
      return jsonResponse({
        success: false,
        source: "gsheet",
        error: "Missing both 'client representative email' and 'internal requester' columns in inquiry sheet.",
        availableHeaders: headers.filter(Boolean)
      }, 500);
    }

    const inquiries = [];
    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] || [];
      const representativeEmail = representativeEmailIdx >= 0 ? normalizeEmail(row[representativeEmailIdx]) : "";
      const internalRequester = internalRequesterIdx >= 0 ? normalizeEmail(row[internalRequesterIdx]) : "";

      if (representativeEmail === email || internalRequester === email) {
        const obj = {};
        headers.forEach((header, colIndex) => {
          if (header) obj[header] = row[colIndex] ?? "";
        });
        inquiries.push(obj);
      }
    }

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: email,
      count: inquiries.length,
      data: inquiries
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
  return jsonResponse({ success: false, error: "Method not allowed. Use GET /api/client/inquiries" }, 405);
}

function buildMockInquiries(email) {
  return [
    {
      "inquiry id": "INQ-DEMO-001",
      "client id": "CLIENT-DEMO-001",
      "client representative email": email,
      "internal requester": "",
      "topic interest": "Leadership & Management Training",
      "main objectives of training": "Improve team leadership, communication, and execution discipline.",
      "targeted trainee profile": "Middle managers and team leaders",
      "targeted trainee qty": "25",
      "language perfer": "English",
      "online_offline": "Offline",
      "venue": "Eastern International University",
      "desired training timeline": "Q3 2026",
      "estimated duration": "24 hours",
      "client representative name": "Demo User",
      "client representative postition": "HR Manager",
      "client representative phone number": "0900000000",
      "inquiry status": "Client updated",
      "bd incharge": "PD Team",
      "inquiry created datetime": "2026-05-01 09:00",
      "inquiry completed datetime": "",
      "inquiry completed by": ""
    }
  ];
}
