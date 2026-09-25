import { jsonResponse, requireClientSession, requireDebugToken } from "../../_lib/security.js";
import {
  assertGoogleSheetsEnv,
  getCoreSpreadsheetId,
  getFeedbackSpreadsheetId,
  getSheetValues,
  getSpreadsheetMetadata,
  quoteSheetName
} from "../../_lib/google-sheets.js";

const CORE_HEADER_SHEETS = [
  "pdc_client_contract_info",
  "pdc-inquiry management"
];

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;

  const auth = await requireClientSession(context.request, env);
  if (!auth.ok) return auth.response;

  const missing = assertGoogleSheetsEnv(env);
  if (missing.length) {
    return jsonResponse({
      success: false,
      error: "Missing Google Sheets environment variables.",
      missing
    }, 500);
  }

  const coreSpreadsheetId = getCoreSpreadsheetId(env);
  const feedbackSpreadsheetId = getFeedbackSpreadsheetId(env);

  try {
    const coreMeta = await getSpreadsheetMetadata(env, coreSpreadsheetId);
    const coreHeaders = {};

    for (const sheetName of CORE_HEADER_SHEETS) {
      try {
        const range = `${quoteSheetName(sheetName)}!A1:AZ1`;
        const values = await getSheetValues(env, coreSpreadsheetId, range);
        coreHeaders[sheetName] = values.values?.[0] || [];
      } catch (err) {
        coreHeaders[sheetName] = { error: err.message };
      }
    }

    let feedback = null;
    if (feedbackSpreadsheetId) {
      try {
        const feedbackMeta = await getSpreadsheetMetadata(env, feedbackSpreadsheetId);
        feedback = {
          spreadsheetId: feedbackSpreadsheetId,
          title: feedbackMeta.properties?.title || "",
          sheets: (feedbackMeta.sheets || []).map(s => ({
            title: s.properties?.title,
            rowCount: s.properties?.gridProperties?.rowCount,
            columnCount: s.properties?.gridProperties?.columnCount
          }))
        };
      } catch (err) {
        feedback = { spreadsheetId: feedbackSpreadsheetId, error: err.message };
      }
    }

    return jsonResponse({
      success: true,
      source: "google-sheets-api",
      authenticatedEmail: auth.session.email,
      dbMode: env.DB_MODE || "gsheet",
      core: {
        spreadsheetId: coreSpreadsheetId,
        title: coreMeta.properties?.title || "",
        sheets: (coreMeta.sheets || []).map(s => ({
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount
        })),
        headerPreview: coreHeaders
      },
      feedback
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.message || "Google Sheets debug check failed."
    }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ success: false, error: "Method not allowed. Use GET /api/debug/sheets" }, 405);
}
