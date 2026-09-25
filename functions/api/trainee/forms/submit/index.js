import { jsonResponse, readJson, requireTraineeSession } from "../../../../_lib/security.js";
import { submitFeedbackFormToSheet } from "../../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../../_lib/repos/repo-utils.js";
import { submitFeedbackFormPsql } from "../../../../_lib/repos/feedback-repo.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const data = parsed.data || {};
  const formId = String(data.formId || data.form_id || "").trim();
  const mappingId = String(data.mappingId || data.mapping_id || "").trim();
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const dryRun = isTruthy(data.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  if (!formId) return jsonResponse({ success: false, error: "Missing formId." }, 400);
  if (!mappingId) return jsonResponse({ success: false, error: "Missing mappingId." }, 400);

  if (dbMode === "mock") {
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      status: "Success",
      message: dryRun ? "Mock feedback dry-run OK." : "Mock feedback submitted.",
      formId,
      mappingId,
      answerCount: answers.length,
      googleUpdatedCells: 0
    });
  }

  if (isPsql(env, "FB_SUBMISSIONS")) {
    try {
      const result = await submitFeedbackFormPsql(env, auth.session.email, formId, mappingId, answers, dryRun);
      const okStatuses = new Set(["Success", "Already Submitted"]);
      const success = okStatuses.has(result.status);
      let statusCode = 200;
      if (!success) {
        if (result.status === "Forbidden") statusCode = 403;
        else statusCode = 400;
      }
      return jsonResponse({
        success,
        source: "psql",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        ...result
      }, statusCode);
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", dbMode, error: err.message || String(err) }, 500);
    }
  }

  try {
    const result = await submitFeedbackFormToSheet(env, auth.session.email, formId, mappingId, answers, dryRun);
    const okStatuses = new Set(["Success", "Already Submitted"]);
    const success = okStatuses.has(result.status);
    let statusCode = 200;
    if (!success) {
      if (result.status === "Forbidden") statusCode = 403;
      else statusCode = 400;
    }
    return jsonResponse({
      success,
      source: "gsheet",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      ...result
    }, statusCode);
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", dbMode, error: err.message || String(err) }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/trainee/forms/submit" }, 405);
}

function isTruthy(value) {
  return [true, "true", "1", 1, "yes", "y", "write"].includes(value);
}
