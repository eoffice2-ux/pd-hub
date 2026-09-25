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
