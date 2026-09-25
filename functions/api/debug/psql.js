import { jsonResponse, requireDebugToken } from "../../_lib/security.js";
import { getTablePsqlName, getTableSource, quoteIdentifierPath } from "../../_lib/data-source.js";
import { assertPostgresEnv, queryPostgres, testPostgresConnection } from "../../_lib/postgres.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;
  const url = new URL(context.request.url);
  const q = String(url.searchParams.get("q") || "test").trim();
  const missing = assertPostgresEnv(env);

  if (missing.length) {
    return jsonResponse({
      success: false,
      psqlConfigured: false,
      missing,
      message: "PostgreSQL is not configured. Set DATABASE_URL/POSTGRES_URL or Hyperdrive binding."
    }, 200);
  }

  const response = {
    success: true,
    psqlConfigured: true,
    organizationSource: getTableSource(env, "ORGANIZATION"),
    organizationTable: getTablePsqlName(env, "ORGANIZATION"),
    connection: null,
    organizationQuery: null
  };

  try {
    response.connection = await testPostgresConnection(env);
  } catch (err) {
    return jsonResponse({
      ...response,
      success: false,
      stage: "connect",
      error: err?.message || String(err),
      code: err?.code || null,
      hint: err?.hint || "Check DATABASE_URL, SSL, firewall, and PostgreSQL logs."
    }, 200);
  }

  try {
    const tableName = quoteIdentifierPath(getTablePsqlName(env, "ORGANIZATION"), "organization PostgreSQL table");
    const sql = `SELECT COUNT(*)::int AS total FROM ${tableName}`;
    const countResult = await queryPostgres(env, sql, []);

    const searchSql = `
      SELECT
        "company_id"::text AS id,
        COALESCE(NULLIF("company_name_GB"::text, ''), "company_name_VN"::text) AS name
      FROM ${tableName}
      WHERE COALESCE(NULLIF("company_name_GB"::text, ''), "company_name_VN"::text) ILIKE $1
      ORDER BY name ASC
      LIMIT 5
    `;
    const searchResult = await queryPostgres(env, searchSql, [`%${q}%`]);
    response.organizationQuery = {
      ok: true,
      query: q,
      totalRows: countResult.rows?.[0]?.total ?? null,
      sampleCount: searchResult.rows?.length || 0,
      sample: searchResult.rows || []
    };
    return jsonResponse(response, 200);
  } catch (err) {
    return jsonResponse({
      ...response,
      success: false,
      stage: "organization-query",
      error: err?.message || String(err),
      code: err?.code || null,
      hint: err?.hint || "Check TAB_ORGANIZATION_PSQL and expected columns: company_id, company_name_GB, company_name_VN."
    }, 200);
  }
}
