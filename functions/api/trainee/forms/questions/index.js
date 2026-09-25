import { jsonResponse, requireTraineeSession } from "../../../../_lib/security.js";
import { getFormQuestionsFromSheet } from "../../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../../_lib/repos/repo-utils.js";
import { getFeedbackQuestionsPsql } from "../../../../_lib/repos/feedback-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const formId = url.searchParams.get("formId") || "";
  const mappingId = url.searchParams.get("mappingId") || "";
  if (!formId.trim()) return jsonResponse({ success: false, error: "Missing formId." }, 400);

  try {
    const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
    if (dbMode === "mock") {
      return jsonResponse({
        success: true,
        source: "mock",
        dbMode,
        authenticatedEmail: auth.session.email,
        formId,
        mappingId,
        count: 2,
        data: [
          { questionId: "Q-DEMO-001", text: "How satisfied are you?", type: "rating", options: "1,2,3,4,5", isRequired: true, sortOrder: 1 },
          { questionId: "Q-DEMO-002", text: "Any comments?", type: "text", options: "", isRequired: false, sortOrder: 2 }
        ]
      });
    }

    if (isPsql(env, "FB_QUESTIONS")) {
      const result = await getFeedbackQuestionsPsql(env, auth.session.email, formId, mappingId);
      if (!result.allowed) {
        return jsonResponse({ success: false, source: "psql", error: result.message || "Forbidden.", formId, mappingId }, 403);
      }
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        formId,
        mappingId,
        count: result.count,
        data: result.data
      });
    }

    const result = await getFormQuestionsFromSheet(env, auth.session.email, formId, mappingId);
    if (!result.allowed) {
      return jsonResponse({ success: false, source: "gsheet", error: result.message || "Forbidden.", formId, mappingId }, 403);
    }
    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      formId,
      mappingId,
      count: result.count,
      data: result.data
    });
  } catch (err) {
    return jsonResponse({ success: false, source: isPsql(env, "FB_QUESTIONS") ? "psql" : "gsheet", error: err.message || String(err), formId, mappingId }, 500);
  }
}
