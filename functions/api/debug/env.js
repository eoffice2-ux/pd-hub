import { jsonResponse, requireDebugToken } from "../../_lib/security.js";
import { assertGoogleSheetsEnv, getCoreSpreadsheetId, getFeedbackSpreadsheetId } from "../../_lib/google-sheets.js";
import { describeAllTables, getTableSource } from "../../_lib/data-source.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;
  const googleMissing = assertGoogleSheetsEnv(env);
  const psqlConfigured = Boolean(env.HYPERDRIVE?.connectionString || env.DATABASE_URL || env.POSTGRES_URL);
  const psqlTables = describeAllTables(env).filter((t) => t.source === "psql");

  return jsonResponse({
    success: true,
    runtimeEnvCheck: {
      googleSheetsConfigured: googleMissing.length === 0,
      googleMissing,
      googleClientEmailPresent: Boolean(env.GOOGLE_CLIENT_EMAIL),
      googlePrivateKeyPresent: Boolean(env.GOOGLE_PRIVATE_KEY),
      googleSheetIdCore: maskId(getCoreSpreadsheetId(env)),
      googleSheetIdFeedback: maskId(getFeedbackSpreadsheetId(env)),
      apiSessionSecretPresent: Boolean(env.API_SESSION_SECRET),
      databaseUrlPresent: Boolean(env.DATABASE_URL || env.POSTGRES_URL),
      hyperdrivePresent: Boolean(env.HYPERDRIVE?.connectionString),
      psqlConfigured,
      psqlTableCount: psqlTables.length,
      mockOtpPresent: Boolean(env.MOCK_OTP),
      sessionTtlSeconds: String(env.SESSION_TTL_SECONDS || "")
    },
    activeSources: {
      clientProfile: getTableSource(env, "CLIENT_PROFILE"),
      traineeProfile: getTableSource(env, "TRAINEE_PROFILE"),
      organization: getTableSource(env, "ORGANIZATION")
    }
  });
}

function maskId(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 10) return "***";
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}
