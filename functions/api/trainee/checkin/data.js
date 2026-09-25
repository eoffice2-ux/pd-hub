import { jsonResponse, requireTraineeSession } from "../../../_lib/security.js";
import { getTraineeCheckinDataFromSheet } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { getTraineeCheckinDataPsql } from "../../../_lib/repos/checkin-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const sectionId = String(url.searchParams.get("sectionId") || "").trim();
  const bypassCache = url.searchParams.has("bypassCache");
  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  if (!sectionId) {
    return jsonResponse({ success: false, error: "Missing sectionId." }, 400);
  }

  try {
    if (dbMode === "mock") {
      return jsonResponse({
        success: true,
        source: "mock",
        dbMode,
        authenticatedEmail: auth.session.email,
        sectionId,
        data: {
          allowed: true,
          sectionId,
          planCount: 1,
          logCount: 0,
          plans: [
            { "checkin slot id": "SLOT-DEMO-001", "section id": sectionId, "checkin code": "DEMO1", "checkin date": "2026-05-30", "checkin valid from": "08:00:00", "checkin valid to": "12:00:00", "checkin type": "Scheduled Check-In" }
          ],
          logs: []
        }
      });
    }

    if (isPsql(env, "CHECKIN_PLAN")) {
      const result = await getTraineeCheckinDataPsql(env, auth.session.email, sectionId, { bypassCache });
      if (!result.allowed) {
        return jsonResponse({
          success: false,
          source: "psql",
          dbMode,
          authenticatedEmail: auth.session.email,
          sectionId,
          error: result.message || "Forbidden. Trainee is not registered for this section."
        }, 403);
      }

      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        sectionId,
        data: {
          plans: result.plans,
          logs: result.logs,
          planCount: result.planCount,
          logCount: result.logCount
        }
      });
    }

    const result = await getTraineeCheckinDataFromSheet(env, auth.session.email, sectionId);
    if (!result.allowed) {
      return jsonResponse({
        success: false,
        source: "gsheet",
        dbMode,
        authenticatedEmail: auth.session.email,
        sectionId,
        error: result.message || "Forbidden. Trainee is not registered for this section."
      }, 403);
    }

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      sectionId,
      data: {
        plans: result.plans,
        logs: result.logs,
        planCount: result.planCount,
        logCount: result.logCount
      }
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      source: isPsql(env, "CHECKIN_PLAN") ? "psql" : "gsheet",
      dbMode,
      sectionId,
      error: err.message || String(err)
    }, 500);
  }
}
