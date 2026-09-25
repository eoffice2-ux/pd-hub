import { jsonResponse, readJson, requireTraineeSession, normalizeEmail } from "../../../_lib/security.js";
import { updateTraineeProfileInSheet, getUserType } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { updateTraineeProfileFromUiPsql } from "../../../_lib/repos/trainee-profile-repo.js";

const ALLOWED_FIELDS = ["fullName", "phone", "gender", "organization", "organizationId", "position", "school", "department"];

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  const data = parsed.data || {};
  const requestedEmail = normalizeEmail(data.email || data.traineeEmail || auth.session.email || "");
  if (requestedEmail && requestedEmail !== normalizeEmail(auth.session.email)) {
    return jsonResponse({ success: false, error: "Forbidden. Requested email does not match the authenticated session." }, 403);
  }

  const sanitized = {};
  for (const key of ALLOWED_FIELDS) {
    if (data[key] !== undefined) sanitized[key] = data[key];
  }
  
  // Always compute and force-save the correct traineeType based on the authenticated email
  sanitized.traineeType = getUserType(requestedEmail);

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      dryRun: data.__dryRun !== false,
      authenticatedEmail: auth.session.email,
      message: "Mock trainee profile update OK. No Google Sheet data was written.",
      updatedFields: Object.keys(sanitized),
      data: sanitized
    });
  }

  if (isPsql(env, "TRAINEE_PROFILE")) {
    try {
      const dryRun = isTruthy(data.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
      let result = {};
      if (!dryRun) {
        result = await updateTraineeProfileFromUiPsql(env, auth.session.email, sanitized);
      }
      return jsonResponse({
        success: true,
        source: "psql",
        dbMode,
        dryRun,
        authenticatedEmail: auth.session.email,
        message: dryRun ? "Dry run OK. No data was written." : "Success",
        ...result
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const dryRun = isTruthy(data.__dryRun || new URL(context.request.url).searchParams.get("dryRun"));
    const result = await updateTraineeProfileInSheet(env, auth.session.email, sanitized, dryRun);
    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      dryRun,
      authenticatedEmail: auth.session.email,
      message: dryRun ? "Dry run OK. No data was written." : "Success",
      ...result
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: "Method not allowed. Use POST /api/trainee/profile/update" }, 405);
}

function isTruthy(value) {
  return [true, "true", "1", 1, "yes", "y"].includes(value);
}
