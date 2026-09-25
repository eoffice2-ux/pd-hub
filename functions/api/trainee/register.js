import { assertEmailAllowed, jsonResponse, normalizeEmail, readJson, requireTraineeSession } from "../../_lib/security.js";
import { registerTraineeForSectionInSheet } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { registerTraineeForSectionPsql } from "../../_lib/repos/registration-repo.js";
import { sendRegistrationConfirmation } from "../../_lib/registration-mailer.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const data = parsed.data || {};
  const emailCheck = assertEmailAllowed(data.email || data.traineeEmail || auth.session.email, auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const sectionId = String(data.sectionId || data["section id"] || "").trim();
  if (!sectionId) return jsonResponse({ success: false, error: "Missing sectionId." }, 400);

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  const dryRun = isTruthy(data.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));

  if (dbMode === "mock") {
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      message: dryRun ? "Mock registration dry-run OK. No data was written." : "Success",
      status: "Success",
      sectionId,
      traineeEmail: normalizeEmail(emailCheck.email),
      googleUpdatedCells: 0
    });
  }

  if (isPsql(env, "SECTION_ATTENDEE")) {
    try {
      const result = await registerTraineeForSectionPsql(env, emailCheck.email, sectionId, dryRun);
      const success = ["Success", "Already Registered"].includes(result.status);
      const statusCode = success ? 200 : (result.status === "Forbidden" ? 403 : 400);

      if (result.status === "Success" && !dryRun) {
        context.waitUntil(
          sendRegistrationConfirmation(env, {
            traineeEmail: emailCheck.email,
            sectionId,
            sectionRow: result.section
          }).catch(err => console.error("[Registration Mailer PSQL]", err))
        );
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
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const result = await registerTraineeForSectionInSheet(env, emailCheck.email, sectionId, dryRun);
    const success = ["Success", "Already Registered"].includes(result.status);
    const statusCode = success ? 200 : (result.status === "Forbidden" ? 403 : 400);

    if (result.status === "Success" && !dryRun) {
      context.waitUntil(
        sendRegistrationConfirmation(env, {
          traineeEmail: emailCheck.email,
          sectionId,
          sectionRow: result.section
        }).catch(err => console.error("[Registration Mailer GSheet]", err))
      );
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
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/trainee/register" }, 405);
}

function isTruthy(value) {
  return [true, "true", "1", 1, "yes", "y"].includes(value);
}
