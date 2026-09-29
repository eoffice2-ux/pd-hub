import { queryPostgres } from "../postgres.js";
import { getTablePsqlName, quoteIdentifierPath } from "../data-source.js";

const ALLOWED_SORT = new Set(["name", "created_at", "status"]);
const ALLOWED_ORDER = new Set(["asc", "desc"]);

export async function listPendingOrgs(env, { sort = "created_at", order = "desc" } = {}) {
  const tableName = quoteIdentifierPath(
    getTablePsqlName(env, "PENDING_ORG") || "public.pdc_pending_organizations",
    "pending org table"
  );
  const orgTableName = quoteIdentifierPath(
    getTablePsqlName(env, "ORGANIZATION") || "public.oce_industry_list",
    "organization table"
  );

  const safeSort = ALLOWED_SORT.has(sort) ? sort : "created_at";
  const safeOrder = ALLOWED_ORDER.has(order) ? order : "desc";

  const sql = `
    SELECT
      p."pd_id",
      p."name",
      p."name_en",
      p."submitted_by",
      p."created_at",
      p."status",
      CASE
        WHEN oce."company_id" IS NOT NULL THEN 'OCE List Updated'
        WHEN lower(p."status") = 'pending'  THEN 'Unverified'
        WHEN lower(p."status") = 'verified' THEN 'Verified'
        WHEN lower(p."status") = 'removed'  THEN 'Removed'
        ELSE p."status"
      END AS resolved_status
    FROM ${tableName} p
    LEFT JOIN ${orgTableName} oce
      ON oce."company_id"::text = p."pd_id"
    ORDER BY p."${safeSort}" ${safeOrder}
  `;

  const result = await queryPostgres(env, sql, []);
  return (result.rows || []).map(row => ({
    pd_id:           row.pd_id || "",
    name:            row.name || "",
    name_en:         row.name_en || "",
    submitted_by:    row.submitted_by || "",
    created_at:      row.created_at || null,
    status:          row.status || "",
    resolved_status: row.resolved_status || row.status || ""
  }));
}

export async function updatePendingOrg(env, { pd_id, name, name_en, status }) {
  const tableName = quoteIdentifierPath(
    getTablePsqlName(env, "PENDING_ORG") || "public.pdc_pending_organizations",
    "pending org table"
  );
  const sql = `
    UPDATE ${tableName}
    SET "name" = $1, "name_en" = $2, "status" = $3
    WHERE "pd_id" = $4
    RETURNING "pd_id", "name", "name_en", "status"
  `;
  const result = await queryPostgres(env, sql, [name, name_en || null, status, pd_id]);
  return (result.rows && result.rows.length > 0) ? result.rows[0] : null;
}
