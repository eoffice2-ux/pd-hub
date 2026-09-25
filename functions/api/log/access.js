import { appendAppLog } from '../../_lib/app-logs.js';
import { jsonResponse, normalizeEmail, readJson } from '../../_lib/security.js';

export async function onRequestPost(context) {
  const parsed = await readJson(context.request);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);
  const data = parsed.data || {};
  const page = String(data.page || data.path || '').slice(0, 120);
  const path = String(data.path || page || new URL(context.request.url).pathname).slice(0, 300);
  const scope = String(data.scope || page || '').toLowerCase().slice(0, 40);
  const email = normalizeEmail(data.email || '');
  const result = await appendAppLog(context.env || {}, {
    event: 'user_access', scope, email, path, success: true,
    detail: { page, referrer: String(data.referrer || '').slice(0, 300) },
    request: context.request
  });
  return jsonResponse({ success: true, logged: result.ok, skipped: result.skipped || false });
}

export async function onRequestGet() {
  return jsonResponse({ success: false, error: 'Method not allowed. Use POST /api/log/access' }, 405);
}
