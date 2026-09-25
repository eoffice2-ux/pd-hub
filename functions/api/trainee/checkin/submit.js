import { assertEmailAllowed, jsonResponse, readJson, requireTraineeSession } from "../../../_lib/security.js";
import { submitTraineeCheckinToSheet } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { submitTraineeCheckinPsql } from "../../../_lib/repos/checkin-repo.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const body = await readJson(context.request);
  if (!body.ok) return jsonResponse({ success: false, error: body.error }, 400);

  const payload = body.data || {};
  const emailCheck = assertEmailAllowed(payload.email || payload.traineeEmail || "", auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const sectionId = String(payload.sectionId || payload["section id"] || "").trim();
  const slotId = String(payload.slotId || payload.checkinSlotId || payload["checkin slot id"] || "").trim();
  const inputCode = String(payload.inputCode || payload.checkinCode || payload.code || payload["checkin code"] || "").trim();
  const dryRun = payload.__dryRun !== false;
  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();

  if (!sectionId) return jsonResponse({ success: false, error: "Missing sectionId." }, 400);
  if (!slotId) return jsonResponse({ success: false, error: "Missing slotId." }, 400);
  if (!inputCode) return jsonResponse({ success: false, error: "Missing check-in code." }, 400);

  try {
    if (dbMode === "mock") {
      if (String(inputCode).toLowerCase().trim() !== "demo1") {
        return jsonResponse({ success: false, source: "mock", dbMode, status: "Incorrect Code", message: "Incorrect check-in code.", sectionId, slotId }, 400);
      }
      return jsonResponse({
        success: true,
        source: "mock",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        status: "Success",
        message: dryRun ? "Dry run OK. No check-in log was appended." : "Check-in successful!",
        sectionId,
        slotId,
        checkedIn: !dryRun,
        googleUpdatedCells: 0
      });
    }

    if (isPsql(env, "CHECKIN_LOG")) {
      const result = await submitTraineeCheckinPsql(env, auth.session.email, sectionId, slotId, inputCode, dryRun);
      const statusCode = result.status === "Forbidden" ? 403 :
        result.status === "Incorrect Code" ? 400 :
        result.status === "Time Window Closed" ? 400 :
        result.status === "Invalid Time Window" ? 400 :
        result.status === "Slot Not Found" ? 404 : 200;

      return jsonResponse({
        success: statusCode === 200,
        source: "psql",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        ...result
      }, statusCode);
    }

    const result = await submitTraineeCheckinToSheet(env, auth.session.email, sectionId, slotId, inputCode, dryRun);
    const statusCode = result.status === "Forbidden" ? 403 :
      result.status === "Incorrect Code" ? 400 :
      result.status === "Time Window Closed" ? 400 :
      result.status === "Invalid Time Window" ? 400 :
      result.status === "Slot Not Found" ? 404 : 200;

    return jsonResponse({
      success: statusCode === 200,
      source: "gsheet",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      ...result
    }, statusCode);
  } catch (err) {
    return jsonResponse({
      success: false,
      source: isPsql(env, "CHECKIN_LOG") ? "psql" : "gsheet",
      dbMode,
      sectionId,
      slotId,
      error: err.message || String(err)
    }, 500);
  }
}
