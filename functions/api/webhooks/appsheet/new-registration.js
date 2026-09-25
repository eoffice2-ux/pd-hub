import { jsonResponse } from "../../../_lib/security.js";
import { sendRegistrationConfirmation } from "../../../_lib/registration-mailer.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  // 1. Authenticate AppSheet Webhook
  const secret = request.headers.get("x-appsheet-secret");
  if (!secret || secret !== env.APPSHEET_WEBHOOK_SECRET) {
    return jsonResponse({ success: false, error: "Unauthorized webhook" }, 401);
  }

  // 2. Parse payload
  let data;
  try {
    data = await request.json();
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }

  const { traineeEmail, sectionId } = data;
  if (!traineeEmail || !sectionId) {
    return jsonResponse({ success: false, error: "Missing required fields: traineeEmail, sectionId" }, 400);
  }

  // 3. Send Email using the exact same mailer used by web registration
  // We use context.waitUntil to let the email send in the background without blocking the webhook response.
  context.waitUntil(
    sendRegistrationConfirmation(env, {
      traineeEmail,
      sectionId
    }).catch(err => console.error("[Webhook Mailer PSQL]", err))
  );

  return jsonResponse({ success: true, message: "New registration email dispatched successfully." }, 200);
}
