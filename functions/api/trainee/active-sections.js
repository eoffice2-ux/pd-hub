import { assertEmailAllowed, jsonResponse, jsonResponseCacheable, requireTraineeSession } from "../../_lib/security.js";
import { getTraineeActiveSectionsFromSheet } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getTraineeActiveSectionsPsql } from "../../_lib/repos/section-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const emailCheck = assertEmailAllowed(url.searchParams.get("email"), auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  try {
    if (dbMode === "mock") {
      return jsonResponseCacheable({
        success: true,
        source: "mock",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        count: 1,
        data: [
          { sectionId: "SEC-DEMO-002", courseName: "Business Communication", status: "In Progress", date: "30/05/2026" }
        ]
      });
    }

    if (isPsql(env, "SECTION")) {
      const result = await getTraineeActiveSectionsPsql(env, emailCheck.email);
      return jsonResponseCacheable({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        registeredCount: result.registeredCount,
        count: result.data.length,
        data: result.data
      });
    }

    const result = await getTraineeActiveSectionsFromSheet(env, emailCheck.email);
    return jsonResponseCacheable({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: emailCheck.email,
      registeredCount: result.registeredCount,
      count: result.data.length,
      data: result.data
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      source: isPsql(env, "SECTION") ? "psql" : "gsheet",
      dbMode,
      error: err.message || String(err)
    }, 500);
  }
}
