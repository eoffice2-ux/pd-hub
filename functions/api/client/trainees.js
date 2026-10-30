import { jsonResponse, requireClientSession } from "../../_lib/security.js";
import { getClientTraineesPsql } from "../../_lib/repos/client-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireClientSession(context.request, env);
  if (!auth.ok) return auth.response;

  try {
    const data = await getClientTraineesPsql(env, auth.session.email);
    if (!data.ok) {
      return jsonResponse({ success: false, error: data.error || "Failed to load client trainees." }, 404);
    }
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
