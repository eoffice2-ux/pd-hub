import { jsonResponse, requireTraineeSession } from "../../_lib/security.js";
import { getSchoolsPsql } from "../../_lib/repos/trainee-profile-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  try {
    const data = await getSchoolsPsql(env);
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
