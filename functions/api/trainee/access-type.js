import { jsonResponse, normalizeEmail } from "../../_lib/security.js";
import { buildAccessType, findTraineeRow, readTraineeTable } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getTraineeAccessTypePsql } from "../../_lib/repos/trainee-profile-repo.js";

// Public compatibility endpoint for the trainee login screen.
// It only returns minimal access metadata (exists/hasPin), not profile details.
export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const email = normalizeEmail(url.searchParams.get("email") || "");
  if (!email || !email.includes("@")) {
    return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return jsonResponse({ success: true, source: "mock", requestedEmail: email, data: { hasPin: true, exists: true } });
  }

  if (isPsql(env, "TRAINEE_PROFILE")) {
    try {
      const data = await getTraineeAccessTypePsql(env, email);
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        requestedEmail: email,
        row: null,
        data
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const { values, headers } = await readTraineeTable(env);
    const found = findTraineeRow(values, headers, email);
    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      requestedEmail: email,
      row: found?.sheetRowNumber || null,
      data: buildAccessType(found?.row, headers)
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
