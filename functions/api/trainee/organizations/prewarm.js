import { jsonResponse, requireTraineeSession } from "../../../_lib/security.js";

export async function onRequestPost(context) {
  const auth = await requireTraineeSession(context.request, context.env || {});
  if (!auth.ok) return auth.response;
  return jsonResponse({
    success: true,
    source: "mock",
    authenticatedEmail: auth.session.email,
    message: "Mock organization cache prewarm OK. No external database was called."
  });
}
