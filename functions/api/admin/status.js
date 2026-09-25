import { jsonResponse, requireAdminOrDebug, requireAdminSession } from "../../_lib/security.js";
import { assertGoogleSheetsEnv, getCoreSpreadsheetId, getFeedbackSpreadsheetId, getSpreadsheetMetadata } from "../../_lib/google-sheets.js";
import { describeAllTables, getTableSource } from "../../_lib/data-source.js";
import { assertPostgresEnv, testPostgresConnection } from "../../_lib/postgres.js";
import { getEmailProvider, getOtpMode, getOtpSheetName, getOtpTtlSeconds, isRealOtpEnabled } from "../../_lib/otp.js";
import { getAppLogSheetName, readAppLogs, summarizeAppLogs } from "../../_lib/app-logs.js";
import { getUserRole } from "../../_lib/user-roles.js";
import { getRecentEmailLogsPsql } from "../../_lib/repos/email-log-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  // Allow: debug token, ADMIN_EMAILS env, or admin role in sheet
  let adminAuth = await requireAdminOrDebug(request, env);
  if (!adminAuth.ok) {
    const sessionAuth = await requireAdminSession(request, env);
    if (sessionAuth.ok) {
      const role = await getUserRole(env, sessionAuth.session.email);
      if (role === "admin") {
        adminAuth = { ok: true, method: "admin-session", session: sessionAuth.session };
      }
    }
  }
  if (!adminAuth.ok) return adminAuth.response;

  const url = new URL(request.url);
  const deep = ["1", "true", "yes"].includes(String(url.searchParams.get("deep") || "").toLowerCase());
  const googleMissing = assertGoogleSheetsEnv(env);
  const psqlMissing = assertPostgresEnv(env);
  const tables = describeAllTables(env);
  const logs = await getLogSnapshot(env, deep ? 120 : 40);
  const emailOtpLogsResult = await getRecentEmailLogsPsql(env, deep ? 100 : 30);
  const psqlTables = tables.filter((item) => item.source === "psql");
  const gsheetTables = tables.filter((item) => item.source === "gsheet");

  const status = {
    emailOtpLogs: emailOtpLogsResult.ok ? emailOtpLogsResult.rows : [],
    success: true,
    generatedAt: new Date().toISOString(),
    environment: {
      dbMode: String(env.DB_MODE || "gsheet"),
      debugTokenConfigured: Boolean(env.DEBUG_TOKEN),
      adminEmailsConfigured: Boolean(env.ADMIN_EMAILS || env.ADMIN_EMAIL),
      authMethod: adminAuth.method || "unknown",
      sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 0) || null,
      appLogSheetName: getAppLogSheetName(env)
    },
    summary: {
      overall: "ok",
      googleSheets: googleMissing.length === 0 ? "ok" : "missing_config",
      otp: isRealOtpEnabled(env) ? "email" : "mock",
      psql: psqlMissing.length === 0 ? "configured" : "not_configured",
      activePsqlTables: psqlTables.length,
      activeGsheetTables: gsheetTables.length,
      totalTables: tables.length,
      userAccessLast24h: logs.summary?.last24h?.userAccess ?? null,
      otpEmailSentLast24h: logs.summary?.last24h?.otpSendOk ?? null,
      otpVerifyLast24h: logs.summary?.last24h?.otpVerifyOk ?? null
    },
    components: {
      googleSheets: {
        configured: googleMissing.length === 0,
        missing: googleMissing,
        coreSpreadsheetId: maskId(getCoreSpreadsheetId(env)),
        feedbackSpreadsheetId: maskId(getFeedbackSpreadsheetId(env))
      },
      otp: {
        mode: getOtpMode(env),
        realOtpEnabled: isRealOtpEnabled(env),
        provider: getEmailProvider(env),
        fromEmailPresent: Boolean(env.OTP_FROM_EMAIL || env.MAIL_FROM_EMAIL),
        brevoApiKeyPresent: Boolean(env.BREVO_API_KEY),
        gas1Present: Boolean(env.EMAIL_CENTER_URL),
        gas2Present: Boolean(env.EMAIL_CENTER_URL_2),
        keepaliveConfigured: Boolean(env.KEEPALIVE_TOKEN),
        otpSheetName: getOtpSheetName(env),
        ttlSeconds: getOtpTtlSeconds(env)
      },
      postgres: {
        configured: psqlMissing.length === 0,
        missing: psqlMissing,
        hyperdrivePresent: Boolean(env.HYPERDRIVE?.connectionString),
        databaseUrlPresent: Boolean(env.DATABASE_URL || env.POSTGRES_URL),
        activeTables: psqlTables.map((item) => item.tableKey)
      },
      logs: {
        configured: logs.ok,
        sheetName: getAppLogSheetName(env),
        totalRows: logs.totalRows || 0,
        summary: logs.summary || null,
        recent: logs.recent || []
      },
      sources: {
        clientProfile: getTableSource(env, "CLIENT_PROFILE"),
        clientInquiry: getTableSource(env, "CLIENT_INQUIRY"),
        traineeProfile: getTableSource(env, "TRAINEE_PROFILE"),
        section: getTableSource(env, "SECTION"),
        checkinLog: getTableSource(env, "CHECKIN_LOG"),
        feedbackSubmissions: getTableSource(env, "FB_SUBMISSIONS"),
        organization: getTableSource(env, "ORGANIZATION")
      }
    },
    tables,
    logs,
    deepChecks: null,
    actions: {
      userApps: ["/client", "/trainee"],
      adminPage: "/admin",
      debugEndpoints: [
        "/api/debug/env?debugToken=<DEBUG_TOKEN>",
        "/api/debug/otp?debugToken=<DEBUG_TOKEN>",
        "/api/debug/data-source?debugToken=<DEBUG_TOKEN>",
        "/api/debug/psql?q=a&debugToken=<DEBUG_TOKEN>"
      ]
    }
  };

  if (deep) {
    status.deepChecks = await runDeepChecks(env);
    const failed = Object.values(status.deepChecks).some((item) => item && item.ok === false);
    if (failed) status.summary.overall = "degraded";
  }

  return jsonResponse(status);
}

async function getLogSnapshot(env, limit) {
  try {
    const result = await readAppLogs(env, { limit });
    if (!result.ok) return { ok: false, error: result.error || 'Unable to read logs.', recent: [], totalRows: 0, summary: null };
    const summary = summarizeAppLogs(result.rows || []);
    return { ok: true, recent: result.rows || [], totalRows: result.totalRows || 0, summary };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), recent: [], totalRows: 0, summary: null };
  }
}

async function runDeepChecks(env) {
  const checks = {
    postgresConnection: null,
    coreSpreadsheet: null,
    feedbackSpreadsheet: null
  };

  if (assertPostgresEnv(env).length === 0) {
    try {
      const result = await testPostgresConnection(env);
      checks.postgresConnection = { ok: true, durationMs: result.durationMs || null, database: result.row?.database_name || null, schema: result.row?.schema_name || null };
    } catch (err) {
      checks.postgresConnection = { ok: false, error: err?.message || String(err), code: err?.code || null };
    }
  } else {
    checks.postgresConnection = { ok: null, skipped: true, reason: "PostgreSQL is not configured." };
  }

  if (assertGoogleSheetsEnv(env).length === 0) {
    try {
      const meta = await getSpreadsheetMetadata(env, getCoreSpreadsheetId(env));
      checks.coreSpreadsheet = { ok: true, title: meta?.properties?.title || null, sheetCount: meta?.sheets?.length || 0 };
    } catch (err) {
      checks.coreSpreadsheet = { ok: false, error: err?.message || String(err) };
    }
    if (getFeedbackSpreadsheetId(env)) {
      try {
        const meta = await getSpreadsheetMetadata(env, getFeedbackSpreadsheetId(env));
        checks.feedbackSpreadsheet = { ok: true, title: meta?.properties?.title || null, sheetCount: meta?.sheets?.length || 0 };
      } catch (err) {
        checks.feedbackSpreadsheet = { ok: false, error: err?.message || String(err) };
      }
    } else {
      checks.feedbackSpreadsheet = { ok: null, skipped: true, reason: "GOOGLE_SHEET_ID_FEEDBACK is not configured." };
    }
  } else {
    checks.coreSpreadsheet = { ok: null, skipped: true, reason: "Google Sheets config is incomplete." };
    checks.feedbackSpreadsheet = { ok: null, skipped: true, reason: "Google Sheets config is incomplete." };
  }

  return checks;
}

function maskId(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 10) return "***";
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}
