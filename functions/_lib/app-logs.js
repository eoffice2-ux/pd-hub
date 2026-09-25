import { appendSheetValues, batchUpdateSheetValues, getCoreSpreadsheetId, getSheetValues, getSpreadsheetMetadata, quoteSheetName } from './google-sheets.js';
import { normalizeEmail } from './security.js';
import { nowVietnamLocal } from './repos/repo-utils.js';

const DEFAULT_LOG_SHEET = 'pdc_app_logs';
export const APP_LOG_HEADERS = [
  'timestamp',
  'event',
  'scope',
  'email',
  'path',
  'success',
  'provider',
  'message_id',
  'detail',
  'ip',
  'user_agent'
];

export function getAppLogSheetName(env = {}) {
  return String(env.TAB_APP_LOG_GSHEET || env.GSHEET_APP_LOG || env.APP_LOG_SHEET_NAME || DEFAULT_LOG_SHEET).trim() || DEFAULT_LOG_SHEET;
}

export async function appendAppLog(env, { event, scope = '', email = '', path = '', success = true, provider = '', messageId = '', detail = '', request = null } = {}) {
  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    if (!spreadsheetId) return { ok: false, skipped: true, reason: 'Missing core spreadsheet id.' };
    const sheetName = getAppLogSheetName(env);
    await ensureAppLogHeader(env, spreadsheetId, sheetName);
    const ip = request?.headers?.get('cf-connecting-ip') || request?.headers?.get('x-forwarded-for') || '';
    const ua = request?.headers?.get('user-agent') || '';
    const row = [
      nowVietnamLocal(),
      String(event || '').slice(0, 80),
      String(scope || '').slice(0, 40),
      normalizeEmail(email || ''),
      String(path || request?.url || '').slice(0, 300),
      success ? 'TRUE' : 'FALSE',
      String(provider || '').slice(0, 80),
      String(messageId || '').slice(0, 160),
      stringifyDetail(detail).slice(0, 1000),
      String(ip || '').slice(0, 120),
      String(ua || '').slice(0, 400)
    ];
    await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:K`, [row], 'USER_ENTERED');
    return { ok: true };
  } catch (err) {
    // Logging must never break user-facing flows.
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function readAppLogs(env, { limit = 50 } = {}) {
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) return { ok: false, rows: [], error: 'Missing core spreadsheet id.' };
  const sheetName = getAppLogSheetName(env);
  await ensureAppLogHeader(env, spreadsheetId, sheetName);
  const values = await getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:K`).then(r => r.values || []);
  if (values.length < 2) return { ok: true, rows: [], totalRows: 0 };
  const headers = normalizeHeaders(values[0]);
  const rows = values.slice(1).map((row, i) => rowToObject(headers, row, i + 2));
  rows.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return { ok: true, rows: rows.slice(0, safeLimit), totalRows: rows.length };
}

export function summarizeAppLogs(rows = []) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const within24h = rows.filter(r => dateMs(r.timestamp) >= now - dayMs);
  const within7d = rows.filter(r => dateMs(r.timestamp) >= now - 7 * dayMs);
  const count = (list, event) => list.filter(r => r.event === event).length;
  const okCount = (list, event) => list.filter(r => r.event === event && boolish(r.success)).length;
  const failCount = (list, event) => list.filter(r => r.event === event && !boolish(r.success)).length;
  return {
    totalRows: rows.length,
    last24h: {
      total: within24h.length,
      userAccess: count(within24h, 'user_access'),
      otpSendOk: okCount(within24h, 'otp_send'),
      otpSendFailed: failCount(within24h, 'otp_send'),
      otpVerifyOk: okCount(within24h, 'otp_verify'),
      otpVerifyFailed: failCount(within24h, 'otp_verify'),
      adminLoginOk: okCount(within24h, 'admin_login'),
      adminLoginFailed: failCount(within24h, 'admin_login')
    },
    last7d: {
      total: within7d.length,
      userAccess: count(within7d, 'user_access'),
      otpSendOk: okCount(within7d, 'otp_send'),
      otpSendFailed: failCount(within7d, 'otp_send'),
      otpVerifyOk: okCount(within7d, 'otp_verify'),
      otpVerifyFailed: failCount(within7d, 'otp_verify'),
      adminLoginOk: okCount(within7d, 'admin_login'),
      adminLoginFailed: failCount(within7d, 'admin_login')
    },
    byPageLast7d: groupCount(within7d, 'path'),
    byScopeLast7d: groupCount(within7d, 'scope')
  };
}

async function ensureAppLogHeader(env, spreadsheetId, sheetName) {
  const range = `${quoteSheetName(sheetName)}!A1:K1`;
  const values = await getSheetValues(env, spreadsheetId, range).then(r => r.values || []).catch(() => []);
  const existing = (values[0] || []).map(v => String(v || '').trim().toLowerCase());
  const required = APP_LOG_HEADERS.map(h => h.toLowerCase());
  const ok = required.every((h, i) => existing[i] === h);
  if (!ok) {
    await batchUpdateSheetValues(env, spreadsheetId, [{ range, values: [APP_LOG_HEADERS] }], 'USER_ENTERED');
  }
}

function rowToObject(headers, row, rowNumber) {
  const out = { rowNumber };
  headers.forEach((h, i) => out[h] = row[i] ?? '');
  return out;
}
function normalizeHeaders(headers) { return (headers || []).map(h => String(h || '').trim().toLowerCase().replace(/\s+/g, '_')); }
function dateMs(value) { const ms = Date.parse(String(value || '')); return Number.isFinite(ms) ? ms : 0; }
function boolish(v) { return ['true','1','yes','ok','success'].includes(String(v || '').toLowerCase()); }
function stringifyDetail(detail) { if (detail == null) return ''; if (typeof detail === 'string') return detail; try { return JSON.stringify(detail); } catch { return String(detail); } }
function groupCount(rows, key) {
  const map = {};
  for (const row of rows) {
    const k = String(row[key] || '(blank)').slice(0, 120);
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
}
