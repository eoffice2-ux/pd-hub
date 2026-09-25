import { jsonResponse, requireTraineeSession } from "../../_lib/security.js";
import { getProgramsPsql } from "../../_lib/repos/trainee-profile-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const schoolId = url.searchParams.get("schoolId");

  try {
    const data = await getProgramsPsql(env, schoolId);
    return jsonResponse({
      success: true,
      data
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.message || String(err)
    }, 500);
  }
}
