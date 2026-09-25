import { assertEmailAllowed, jsonResponse, readJson, requireTraineeSession } from "../../../_lib/security.js";
import { setTraineePinInSheet } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { setTraineePinPsql } from "../../../_lib/repos/trainee-profile-repo.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const body = parsed.data || {};
  const emailCheck = assertEmailAllowed(body.email, auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  if (!/^\d{4}$/.test(String(body.pin || ""))) {
    return jsonResponse({ success: false, error: "PIN must be 4 digits." }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return jsonResponse({ success: true, source: "mock", dryRun: body.__dryRun !== false, authenticatedEmail: auth.session.email, message: "Mock PIN update OK. No Google Sheet data was written." });
  }

  if (isPsql(env, "TRAINEE_PROFILE")) {
    try {
      const dryRun = isTruthy(body.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
      let result = {};
      if (!dryRun) {
        result = await setTraineePinPsql(env, emailCheck.email, body.pin);
      }
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        message: dryRun ? "Dry run OK. No data was written." : "PIN successfully updated.",
        ...result
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const dryRun = isTruthy(body.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
    const result = await setTraineePinInSheet(env, emailCheck.email, body.pin, dryRun);
    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      message: dryRun ? "Dry run OK. No data was written." : "PIN successfully updated.",
      ...result
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}

function isTruthy(value) {
  return [true, "true", "1", 1, "yes", "y"].includes(value);
}
