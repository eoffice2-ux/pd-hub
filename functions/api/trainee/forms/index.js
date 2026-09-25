import { jsonResponse, jsonResponseCacheable, requireTraineeSession } from "../../../_lib/security.js";
import { getFormsForSectionFromSheet } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { getFormsForSectionPsql } from "../../../_lib/repos/feedback-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const sectionId = url.searchParams.get("sectionId") || "";
  if (!sectionId.trim()) return jsonResponse({ success: false, error: "Missing sectionId." }, 400);

  try {
    const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
    if (dbMode === "mock") {
      return jsonResponseCacheable({
        success: true,
        source: "mock",
        dbMode,
        authenticatedEmail: auth.session.email,
        sectionId,
        count: 1,
        data: [{ mappingId: "MAP-DEMO-001", formId: "FORM-DEMO-001", sectionId, title: "Demo Feedback Form", description: "Demo read-only feedback form.", startTime: "2000-01-01T00:00:00.000Z", endTime: "2099-12-31T23:59:59.000Z", status: "Active" }]
      });
    }

    if (isPsql(env, "FB_SECTIONFORMS")) {
      const result = await getFormsForSectionPsql(env, auth.session.email, sectionId);
      if (!result.allowed) {
        return jsonResponse({ success: false, source: "psql", error: result.message || "Forbidden.", sectionId }, 403);
      }
      return jsonResponseCacheable({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        sectionId,
        count: result.count,
        data: result.data
      });
    }

    const result = await getFormsForSectionFromSheet(env, auth.session.email, sectionId);
    if (!result.allowed) {
      return jsonResponse({ success: false, source: "gsheet", error: result.message || "Forbidden.", sectionId }, 403);
    }
    return jsonResponseCacheable({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      sectionId,
      count: result.count,
      data: result.data
    });
  } catch (err) {
    return jsonResponse({ success: false, source: isPsql(env, "FB_SECTIONFORMS") ? "psql" : "gsheet", error: err.message || String(err), sectionId }, 500);
  }
}
