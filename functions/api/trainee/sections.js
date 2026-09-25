import { assertEmailAllowed, jsonResponse, jsonResponseCacheable, requireTraineeSession } from "../../_lib/security.js";
import { getTraineeSectionsFromSheet } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getTraineeSectionsPsql } from "../../_lib/repos/section-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const emailCheck = assertEmailAllowed(url.searchParams.get("email"), auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    const data = [
      { id: "SEC-DEMO-001", name: "Project Management Essentials", date: "23/05/2026", venue: "Eastern International University", status: "Open for registration", isRegistered: false },
      { id: "SEC-DEMO-002", name: "Business Communication", date: "30/05/2026", venue: "Eastern International University", status: "Registered", isRegistered: true },
      { id: "SEC-DEMO-003", name: "Leadership Foundations", date: "06/06/2026", venue: "Online", status: "Registration Closed", isRegistered: false }
    ];
    return jsonResponseCacheable({ success: true, source: "mock", dbMode, authenticatedEmail: auth.session.email, requestedEmail: emailCheck.email, count: data.length, data });
  }

  if (isPsql(env, "SECTION")) {
    try {
      const result = await getTraineeSectionsPsql(env, emailCheck.email);
      return jsonResponseCacheable({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        userType: result.userType,
        registeredCount: result.registeredCount,
        count: result.data.length,
        data: result.data
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const result = await getTraineeSectionsFromSheet(env, emailCheck.email);
    return jsonResponseCacheable({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: emailCheck.email,
      userType: result.userType,
      registeredCount: result.registeredCount,
      count: result.data.length,
      data: result.data
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
