import { assertEmailAllowed, jsonResponse, jsonResponseCacheable, requireTraineeSession } from "../../_lib/security.js";
import { getTraineeHistoryFromSheet } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getTraineeHistoryPsql } from "../../_lib/repos/registration-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const emailCheck = assertEmailAllowed(url.searchParams.get("email"), auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  try {
    const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
    if (dbMode === "mock") {
      return jsonResponseCacheable({
        success: true,
        source: "mock",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        count: 1,
        data: [{ sectionId: "SEC-DEMO-HIS-001", sectionNameEn: "Completed Demo Course", status: "Completed", sectionDate: "01/05/2026", dateStart: "01/05/2026", checkinEndTimestamp: 1777651199000, registeredAt: "20/04/2026 09:00", checkin: "2 / 2 (100%)", assessment: "100%", feedback: "1 / 1 (100%)", certIssued: "" }]
      });
    }

    if (isPsql(env, "SECTION_ATTENDEE")) {
      const result = await getTraineeHistoryPsql(env, emailCheck.email);
      return jsonResponseCacheable({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        count: result.count,
        data: result.data
      });
    }

    const result = await getTraineeHistoryFromSheet(env, emailCheck.email);
    return jsonResponseCacheable({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: emailCheck.email,
      count: result.count,
      data: result.data
    });
  } catch (err) {
    return jsonResponse({ success: false, source: isPsql(env, "SECTION_ATTENDEE") ? "psql" : "gsheet", error: err.message || String(err) }, 500);
  }
}
