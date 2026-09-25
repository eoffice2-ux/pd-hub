import { appendSheetValues, batchUpdateSheetValues, getCoreSpreadsheetId, getSheetValues, makeCellRange, quoteSheetName } from "./google-sheets.js";
import { normalizeEmail } from "./security.js";
import { logEmailAttempt } from "./repos/email-log-repo.js";
import { formatVietnamLocal, nowVietnamLocal } from "./repos/repo-utils.js";
import { sendEmail } from "./email-sender.js";

const DEFAULT_OTP_TTL_SECONDS = 10 * 60;
const DEFAULT_OTP_SHEET = "temp_otp";
const OTP_HEADERS = [
  "email",
  "otp_hash",
  "scope",
  "created_at",
  "expires_at",
  "used_at",
  "send_provider",
  "request_ip",
  "user_agent"
];

export function getOtpMode(env = {}) {
  return String(env.OTP_MODE || "mock").trim().toLowerCase();
}

export function isRealOtpEnabled(env = {}) {
  return getOtpMode(env) === "email" || getOtpMode(env) === "real" || getOtpMode(env) === "provider";
}

export function getOtpTtlSeconds(env = {}) {
  const ttl = Number(env.OTP_TTL_SECONDS || env.OTP_EXPIRY_SECONDS || DEFAULT_OTP_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl >= 60 ? Math.floor(ttl) : DEFAULT_OTP_TTL_SECONDS;
}

export function getOtpSheetName(env = {}) {
  return String(env.TAB_OTP_GSHEET || env.GSHEET_OTP || env.OTP_SHEET_NAME || DEFAULT_OTP_SHEET).trim() || DEFAULT_OTP_SHEET;
}

export function generateOtp() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = new DataView(bytes.buffer).getUint32(0) % 1000000;
  return String(value).padStart(6, "0");
}

export async function storeOtp(env, { email, otp, scope = "client", request }) {
  const cleanEmail = normalizeEmail(email);
  const now = new Date();
  const expires = new Date(now.getTime() + getOtpTtlSeconds(env) * 1000);
  const otpHash = await hashOtp(env, cleanEmail, otp);
  const sheetName = getOtpSheetName(env);
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE for OTP storage.");

  await ensureOtpHeader(env, spreadsheetId, sheetName);

  const ip = request?.headers?.get("cf-connecting-ip") || request?.headers?.get("x-forwarded-for") || "";
  const ua = request?.headers?.get("user-agent") || "";
  const provider = getEmailProvider(env);

  const row = [
    cleanEmail,
    otpHash,
    String(scope || "client").toLowerCase(),
    formatVietnamLocal(now),
    formatVietnamLocal(expires),
    "",
    provider,
    ip,
    ua.slice(0, 300)
  ];

  await appendSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:I`, [row], "USER_ENTERED");
  return { expiresAt: expires.toISOString(), expiresInSeconds: getOtpTtlSeconds(env), provider };
}

export async function verifyStoredOtp(env, { email, otp, scope = "client" }) {
  const cleanEmail = normalizeEmail(email);
  const cleanOtp = String(otp || "").trim();
  if (!/^\d{6}$/.test(cleanOtp)) return { ok: false, error: "Invalid or expired OTP." };

  const sheetName = getOtpSheetName(env);
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE for OTP verification.");

  const values = await getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:I`, { bypassCache: true }).then(r => r.values || []);
  if (values.length < 2) return { ok: false, error: "Invalid or expired OTP." };

  const headers = normalizeHeaders(values[0]);
  const idx = indexMap(headers);
  const expectedHash = await hashOtp(env, cleanEmail, cleanOtp);
  const nowMs = Date.now();
  const requestedScope = String(scope || "client").toLowerCase();

  let best = null;
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowEmail = normalizeEmail(row[idx.email] || "");
    if (rowEmail !== cleanEmail) continue;
    const rowHash = String(row[idx.otp_hash] || row[idx.otp] || "").trim();
    if (rowHash !== expectedHash && rowHash !== cleanOtp) continue; // legacy/plain fallback if sheet contains old OTP values
    const rowScope = String(row[idx.scope] || requestedScope || "client").toLowerCase();
    if (rowScope && requestedScope && rowScope !== requestedScope && rowScope !== "all") continue;
    const usedAt = String(row[idx.used_at] || "").trim();
    if (usedAt) continue;
    const expiresAt = parseDateMs(row[idx.expires_at]);
    if (!expiresAt || expiresAt < nowMs) continue;
    const createdAt = parseDateMs(row[idx.created_at]) || 0;
    if (!best || createdAt > best.createdAt) {
      best = { rowNumber: i + 1, createdAt };
    }
  }

  if (!best) return { ok: false, error: "Invalid or expired OTP." };

  if (idx.used_at >= 0) {
    await batchUpdateSheetValues(env, spreadsheetId, [{
      range: makeCellRange(sheetName, best.rowNumber, idx.used_at + 1),
      values: [[nowVietnamLocal()]]
    }], "USER_ENTERED");
  }

  return { ok: true };
}

export async function sendOtpEmail(env, { to, otp, scope = "client" }) {
  const appName = String(env.OTP_APP_NAME || "PD Hub").trim();
  const ttlMinutes = Math.max(1, Math.round(getOtpTtlSeconds(env) / 60));
  const subject = String(env.OTP_SUBJECT || `Your ${appName} Login Code: ${otp}`);
  const html = buildOtpHtml({ appName, otp, ttlMinutes });
  const text = `Your ${appName} login code is: ${otp}\n\nThis code will expire in ${ttlMinutes} minutes. If you did not request this, please ignore this email.`;

  const logAttempt = async (service, status, detail) => {
    const appVal = scope === "admin" ? "admin" : "trainee";
    await logEmailAttempt(env, {
      app: appVal,
      userEmail: to,
      otp,
      sendingService: service,
      status,
      detail
    });
  };

  try {
    const result = await sendEmail(env, { to, subject, html, text, logContext: "OTP" });
    await logAttempt(result.provider, "success", `Sent via ${result.provider} (${result.id || "ok"})`);
    return result;
  } catch (err) {
    await logAttempt("unknown", "failed", err.message);
    throw err;
  }
}

export function getEmailProvider(env = {}) {
  return String(env.OTP_EMAIL_PROVIDER || env.EMAIL_PROVIDER || "resend").trim().toLowerCase();
}

async function ensureOtpHeader(env, spreadsheetId, sheetName) {
  const range = `${quoteSheetName(sheetName)}!A1:I1`;
  const values = await getSheetValues(env, spreadsheetId, range).then(r => r.values || []).catch(() => []);
  const existing = values[0] || [];
  const normalized = normalizeHeaders(existing);
  const hasModernHeader = normalized.includes("email") && normalized.includes("otp_hash") && normalized.includes("expires_at");
  if (!hasModernHeader) {
    // Safe for empty temp_otp sheets. If an old sheet has unrelated headers, this makes OTP storage deterministic.
    await batchUpdateSheetValues(env, spreadsheetId, [{ range, values: [OTP_HEADERS] }], "USER_ENTERED");
  }
}

function normalizeHeaders(headers) {
  return (headers || []).map(h => String(h || "").toLowerCase().trim());
}

function indexMap(headers) {
  const aliases = {
    email: ["email", "user_email", "trainee_id", "client_email"],
    otp_hash: ["otp_hash", "otp hash", "code_hash", "otp", "otp_code"],
    otp: ["otp", "otp_code", "code"],
    scope: ["scope", "audience", "role"],
    created_at: ["created_at", "created at", "created", "timestamp", "requested_at"],
    expires_at: ["expires_at", "expires at", "expired_at", "expiry", "expired datetime"],
    used_at: ["used_at", "used at", "verified_at", "consumed_at"]
  };
  const out = {};
  for (const [key, names] of Object.entries(aliases)) {
    out[key] = names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
  }
  return out;
}

async function hashOtp(env, email, otp) {
  const secret = String(env.OTP_SECRET || env.API_SESSION_SECRET || "pd-onestop-dev-secret-change-me");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${email}:${otp}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseDateMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function buildOtpHtml({ appName, otp, ttlMinutes }) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;color:#111827;">
    <h2 style="margin:0 0 12px;color:#0f4c81;">${escapeHtml(appName)} Login Code</h2>
    <p style="font-size:15px;line-height:1.5;">Use this verification code to sign in:</p>
    <div style="background:#f3f4f6;border-radius:10px;padding:20px;text-align:center;margin:20px 0;">
      <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#0f4c81;">${otp}</span>
    </div>
    <p style="font-size:13px;color:#6b7280;">This code expires in ${ttlMinutes} minutes. If you did not request this code, you can ignore this email.</p>
  </div>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}
