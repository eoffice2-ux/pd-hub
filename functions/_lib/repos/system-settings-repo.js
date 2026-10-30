import { queryPostgres } from "../postgres.js";

/**
 * System Settings Repository (pdc_system_settings)
 * Reads/writes system settings in PostgreSQL with fallback to Cloudflare env variables.
 */

export async function getSystemSetting(env, key, fallbackEnvKey = null) {
  const cleanKey = String(key || "").trim().toLowerCase();
  if (!cleanKey) return null;

  try {
    const res = await queryPostgres(
      env,
      `SELECT "value" FROM public.pdc_system_settings WHERE LOWER(TRIM("key")) = $1 LIMIT 1`,
      [cleanKey]
    );
    if (res.rows && res.rows.length > 0 && res.rows[0].value !== null && res.rows[0].value !== undefined) {
      const val = String(res.rows[0].value).trim();
      if (val) return val;
    }
  } catch (err) {
    // Table might not exist yet or connection error; fall through to env
  }

  // Fallback to environment variables
  if (fallbackEnvKey && env[fallbackEnvKey]) {
    return String(env[fallbackEnvKey]).trim();
  }

  // Try direct uppercase key in env
  const envKey = cleanKey.toUpperCase();
  if (env[envKey]) {
    return String(env[envKey]).trim();
  }

  return null;
}

const FALLBACK_GOOGLE_CLIENT_ID = "41484975128-tl3pd0s0njmrsob8msa83g94qt4mmanp.apps.googleusercontent.com";
const FALLBACK_MS_CLIENT_ID = "8be420ab-0c92-48b9-bff7-efad4b537a64";

export async function getOAuthSettings(env) {
  const [googleId, googleSecret, msId, msSecret] = await Promise.all([
    getSystemSetting(env, "oauth_google_client_id", "GOOGLE_OAUTH_CLIENT_ID"),
    getSystemSetting(env, "oauth_google_client_secret", "GOOGLE_OAUTH_CLIENT_SECRET"),
    getSystemSetting(env, "oauth_microsoft_client_id", "MICROSOFT_OAUTH_CLIENT_ID"),
    getSystemSetting(env, "oauth_microsoft_client_secret", "MICROSOFT_OAUTH_CLIENT_SECRET")
  ]);

  const effectiveGoogleId = googleId || String(env.GOOGLE_OAUTH_CLIENT_ID || "").trim() || FALLBACK_GOOGLE_CLIENT_ID;
  const effectiveMsId = msId || String(env.MICROSOFT_OAUTH_CLIENT_ID || "").trim() || FALLBACK_MS_CLIENT_ID;

  return {
    google: {
      clientId: effectiveGoogleId,
      clientSecret: googleSecret || "",
      isConfigured: Boolean(effectiveGoogleId)
    },
    microsoft: {
      clientId: effectiveMsId,
      clientSecret: msSecret || "",
      tenant: "common",
      isConfigured: Boolean(effectiveMsId)
    }
  };
}

export async function setSystemSetting(env, key, value, updatedBy = "admin", category = "auth") {
  const cleanKey = String(key || "").trim().toLowerCase();
  if (!cleanKey) throw new Error("Missing setting key.");

  // Ensure table exists on first write
  await ensureSystemSettingsTable(env);

  const sql = `
    INSERT INTO public.pdc_system_settings ("key", "value", "category", "updated_by", "updated_at")
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "value" = EXCLUDED."value",
      "category" = EXCLUDED."category",
      "updated_by" = EXCLUDED."updated_by",
      "updated_at" = NOW()
  `;

  await queryPostgres(env, sql, [cleanKey, String(value ?? ""), category, String(updatedBy || "admin")]);
  return { success: true, key: cleanKey };
}

export async function ensureSystemSettingsTable(env) {
  try {
    await queryPostgres(env, `
      CREATE TABLE IF NOT EXISTS public.pdc_system_settings (
        "key" VARCHAR(100) PRIMARY KEY,
        "value" TEXT,
        "category" VARCHAR(50) DEFAULT 'auth',
        "updated_by" VARCHAR(255),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.warn("ensureSystemSettingsTable note:", err.message);
  }
}
