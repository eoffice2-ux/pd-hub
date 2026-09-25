import { jsonResponse, requireDebugToken } from "../../_lib/security.js";
import { describeAllTables } from "../../_lib/data-source.js";
import { assertPostgresEnv } from "../../_lib/postgres.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;
  const tables = describeAllTables(env);
  const psqlTables = tables.filter((item) => item.source === "psql");
  return jsonResponse({
    success: true,
    defaultSource: String(env.DB_MODE || "gsheet"),
    psqlConfigured: assertPostgresEnv(env).length === 0,
    psqlMissing: assertPostgresEnv(env),
    tableCount: tables.length,
    psqlTableCount: psqlTables.length,
    tables
  });
}
