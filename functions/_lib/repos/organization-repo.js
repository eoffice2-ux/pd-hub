import { getTablePsqlName, quoteIdentifierPath } from "../data-source.js";
import { queryPostgres } from "../postgres.js";

export async function searchOrganizationsPsql(env, query, options = {}) {
  const tableName = quoteIdentifierPath(getTablePsqlName(env, "ORGANIZATION"), "organization PostgreSQL table");
  const idCol = quoteIdentifierPath("company_id", "organization id column");
  const nameGbCol = quoteIdentifierPath("company_name_GB", "organization English name column");
  const nameVnCol = quoteIdentifierPath("company_name_VN", "organization Vietnamese name column");
  const limit = Math.min(Math.max(Number(options.limit || 15), 1), 50);
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const sql = `
    SELECT
      ${idCol}::text AS id,
      COALESCE(NULLIF(${nameGbCol}::text, ''), ${nameVnCol}::text) AS name
    FROM ${tableName}
    WHERE COALESCE(NULLIF(${nameGbCol}::text, ''), ${nameVnCol}::text) ILIKE $1
    ORDER BY name ASC
    LIMIT ${limit}
  `;
  const result = await queryPostgres(env, sql, [`%${q}%`]);
  return (result.rows || [])
    .filter((row) => row && row.name)
    .map((row) => ({ id: row.id || "", name: row.name || "" }));
}

export async function searchPendingOrgsPsql(env, query, options = {}) {
  const tableName = quoteIdentifierPath(getTablePsqlName(env, "PENDING_ORG") || "public.pdc_pending_organizations", "pending organization PostgreSQL table");
  const orgTableName = quoteIdentifierPath(getTablePsqlName(env, "ORGANIZATION") || "public.oce_industry_list", "organization PostgreSQL table");
  const limit = Math.min(Math.max(Number(options.limit || 5), 1), 20);
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const sql = `
    SELECT
      p."pd_id"::text AS id,
      p."name"::text AS name,
      CASE
        WHEN oce."company_id" IS NOT NULL THEN 'OCE List Updated'
        WHEN lower(p."status") = 'pending'  THEN 'Unverified'
        WHEN lower(p."status") = 'verified' THEN 'Verified'
        ELSE p."status"
      END AS resolved_status
    FROM ${tableName} p
    LEFT JOIN ${orgTableName} oce
      ON oce."company_id"::text = p."pd_id"
    WHERE p."name" ILIKE $1
    ORDER BY p."name" ASC
    LIMIT ${limit}
  `;
  try {
    const result = await queryPostgres(env, sql, [`%${q}%`]);
    return (result.rows || [])
      .filter((row) => row && row.name)
      .map((row) => ({
        id: row.id || "",
        name: row.name || "",
        source: "pending",
        resolved_status: row.resolved_status || "Unverified"
      }));
  } catch (err) {
    console.warn("searchPendingOrgsPsql warning:", err?.message || err);
    return [];
  }
}
