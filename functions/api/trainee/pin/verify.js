import { assertEmailAllowed, issueSessionToken, jsonResponse, normalizeEmail, readJson, requireTraineeSession } from "../../../_lib/security.js";
import { findTraineeRow, getPinValue, readTraineeTable } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { verifyTraineePinPsql } from "../../../_lib/repos/trainee-profile-repo.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const body = parsed.data || {};
  const email = normalizeEmail(body.email || body.traineeEmail || "");
  if (!email || !email.includes("@")) return jsonResponse({ success: false, error: "Missing or invalid email." }, 400);

  // If a token is already present, keep the strict ownership check.
  const authHeader = context.request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const auth = await requireTraineeSession(context.request, env);
    if (!auth.ok) return auth.response;
    const emailCheck = assertEmailAllowed(email, auth.session.email);
    if (!emailCheck.ok) return emailCheck.response;
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    const ok = String(body.pin || "") === String(env.MOCK_PIN || "1234");
    if (!ok) return jsonResponse({ success: true, source: "mock", data: { ok: false } });
    const session = await issueSessionToken(email, env, "trainee");
    return jsonResponse({ success: true, source: "mock", data: { ok: true, token: session.token, expiresAt: session.expiresAt, expiresInSeconds: session.expiresInSeconds } });
  }

  if (isPsql(env, "TRAINEE_PROFILE")) {
    try {
      const result = await verifyTraineePinPsql(env, email, body.pin);
      if (!result.ok) {
        return jsonResponse({ success: true, source: "psql", dbMode, row: null, data: { ok: false } });
      }
      const session = await issueSessionToken(email, env, "trainee");
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        row: null,
        data: { ok: true, token: session.token, expiresAt: session.expiresAt, expiresInSeconds: session.expiresInSeconds }
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const { values, headers } = await readTraineeTable(env);
    const found = findTraineeRow(values, headers, email);
    const realPin = found ? String(getPinValue(found.row, headers) || "").padStart(4, "0") : "";
    const ok = realPin !== "" && realPin === String(body.pin || "");
    if (!ok) return jsonResponse({ success: true, source: "gsheet", dbMode, row: found?.sheetRowNumber || null, data: { ok: false } });

    const session = await issueSessionToken(email, env, "trainee");
    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      row: found?.sheetRowNumber || null,
      data: { ok: true, token: session.token, expiresAt: session.expiresAt, expiresInSeconds: session.expiresInSeconds }
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
