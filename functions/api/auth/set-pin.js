import { jsonResponse, requireSessionScope } from "../../_lib/security.js";
import { setUserPin } from "../../_lib/user-roles.js";
import { appendAppLog } from "../../_lib/app-logs.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const auth = await requireSessionScope(context.request, env, ["client", "admin", "all"]);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);
  }

  const pin = String(body.pin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return jsonResponse({ success: false, error: "PIN must be 4 digits." }, 400);
  }

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  const email = auth.session.email;

  // In mock mode, we just return success
  if (dbMode === "mock") {
    await appendAppLog(env, { event: "pin_changed", scope: "auth", email, success: true, detail: `Mock PIN update (${auth.session.scope})`, request: context.request });
    return jsonResponse({
      success: true,
      source: "mock",
      message: "PIN updated successfully (mock)."
    });
  }

  try {
    // defaultRole depends on scope
    const defaultRole = auth.session.scope === "admin" ? "admin" : "client";
    const result = await setUserPin(env, email, pin, defaultRole);
    await appendAppLog(env, { event: "pin_changed", scope: "auth", email, success: true, detail: `PIN updated (${auth.session.scope})`, request: context.request });

    return jsonResponse({
      success: true,
      source: "gsheet",
      dbMode,
      message: "PIN updated successfully.",
      data: result
    });
  } catch (err) {
    await appendAppLog(env, { event: "pin_changed", scope: "auth", email, success: false, detail: err?.message || String(err), request: context.request });
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}
