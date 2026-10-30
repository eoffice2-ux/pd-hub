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
      END AS resolved_status,
      COALESCE(t_agg.trainee_count, 0) AS trainee_count,
      COALESCE(t_agg.trainees, '[]'::json) AS trainees
    FROM ${tableName} p
    LEFT JOIN ${orgTableName} oce
      ON oce."company_id"::text = p."pd_id"
    LEFT JOIN (
      SELECT
        LOWER(TRIM(t."trainee organization id")) AS org_id_match,
        COUNT(*)::int AS trainee_count,
        json_agg(
          json_build_object(
            'traineeId', COALESCE(t."trainee id", t."trainee email"),
            'email', t."trainee email",
            'fullName', COALESCE(t."trainee full name", '(No Name)'),
            'phone', COALESCE(t."trainee phone", ''),
            'position', COALESCE(t."trainee position", ''),
            'organizationId', t."trainee organization id",
            'organizationName', t."trainee organization new"
          ) ORDER BY t."trainee full name" ASC
        ) AS trainees
      FROM public."pdc_trainee general profile" t
      WHERE t."trainee organization id" IS NOT NULL AND TRIM(t."trainee organization id") <> ''
      GROUP BY LOWER(TRIM(t."trainee organization id"))
    ) t_agg ON t_agg.org_id_match = LOWER(TRIM(p."pd_id"))
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
    resolved_status: row.resolved_status || row.status || "",
    trainee_count:   Number(row.trainee_count || 0),
    trainees:        Array.isArray(row.trainees) ? row.trainees : []
  }));
}

/**
 * List all company IDs currently used by trainees in pdc_trainee general profile.
 * Helps Admins spot any wrong company ID (pending or official), see how many & who,
 * and batch-reassign them.
 */
export async function listAllUsedTraineeOrgs(env, { search = "" } = {}) {
  let searchClause = "";
  const params = [];
  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    searchClause = `
      WHERE LOWER(TRIM(t."trainee organization id")) LIKE $1
         OR LOWER(TRIM(t."trainee organization new")) LIKE $1
    `;
  }

  const sql = `
    SELECT
      t."trainee organization id" AS org_id,
      MAX(t."trainee organization new") AS org_name,
      COUNT(*)::int AS trainee_count,
      CASE
        WHEN oce.company_id IS NOT NULL THEN true
        ELSE false
      END AS is_official_oce,
      oce.company_id AS oce_id,
      oce.company_name_vn AS oce_name_vn,
      oce.company_name_en AS oce_name_en,
      CASE
        WHEN pend.pd_id IS NOT NULL THEN true
        ELSE false
      END AS is_pending_org,
      pend.status AS pending_status,
      json_agg(
        json_build_object(
          'traineeId', COALESCE(t."trainee id", t."trainee email"),
          'email', t."trainee email",
          'fullName', COALESCE(t."trainee full name", '(No Name)'),
          'phone', COALESCE(t."trainee phone", ''),
          'position', COALESCE(t."trainee position", ''),
          'organizationId', t."trainee organization id",
          'organizationName', t."trainee organization new"
        ) ORDER BY t."trainee full name" ASC
      ) AS trainees
    FROM public."pdc_trainee general profile" t
    LEFT JOIN public.oce_industry_list oce 
      ON LOWER(TRIM(oce.company_id)) = LOWER(TRIM(t."trainee organization id"))
    LEFT JOIN public.pdc_pending_organizations pend
      ON LOWER(TRIM(pend.pd_id)) = LOWER(TRIM(t."trainee organization id"))
    ${searchClause}
    GROUP BY t."trainee organization id", oce.company_id, oce.company_name_vn, oce.company_name_en, pend.pd_id, pend.status
    ORDER BY COUNT(*) DESC, MAX(t."trainee organization new") ASC
  `;

  const result = await queryPostgres(env, sql, params);
  return (result.rows || []).map(r => ({
    orgId: r.org_id || "(empty)",
    orgName: r.org_name || "(No name)",
    traineeCount: Number(r.trainee_count || 0),
    isOfficialOce: Boolean(r.is_official_oce),
    oceId: r.oce_id || "",
    oceNameVn: r.oce_name_vn || "",
    oceNameEn: r.oce_name_en || "",
    isPendingOrg: Boolean(r.is_pending_org),
    pendingStatus: r.pending_status || "",
    trainees: Array.isArray(r.trainees) ? r.trainees : []
  }));
}

/**
 * Batch reassign trainees from a source company ID/name to a target company ID/name.
 * If specific emails are given in traineeEmails, reassigns only those;
 * otherwise reassigns all trainees currently using sourceOrgId.
 */
export async function batchReassignTraineesOrganization(env, {
  sourceOrgId,
  sourceOrgName,
  traineeEmails = [],
  targetCompanyId,
  targetCompanyName,
  pendingPdId = "",
  markPendingVerified = true,
  adminEmail = "admin"
}) {
  const cleanTargetId = String(targetCompanyId || "").trim();
  let finalTargetName = String(targetCompanyName || "").trim();

  if (!cleanTargetId) {
    throw new Error("Target company ID is required.");
  }

  // If target company name is not provided, look it up in oce_industry_list
  if (!finalTargetName) {
    const oceRes = await queryPostgres(env, `
      SELECT company_name_vn, company_name_en FROM public.oce_industry_list
      WHERE LOWER(TRIM(company_id)) = LOWER(TRIM($1)) LIMIT 1
    `, [cleanTargetId]);
    if (oceRes.rows && oceRes.rows.length > 0) {
      finalTargetName = oceRes.rows[0].company_name_vn || oceRes.rows[0].company_name_en || cleanTargetId;
    } else {
      finalTargetName = cleanTargetId;
    }
  }

  let updateSql = "";
  let updateParams = [];

  if (Array.isArray(traineeEmails) && traineeEmails.length > 0) {
    const cleanEmails = traineeEmails.map(e => String(e).toLowerCase().trim());
    updateSql = `
      UPDATE public."pdc_trainee general profile"
      SET "trainee organization id" = $1,
          "trainee organization new" = $2,
          "user updated datetime" = NOW()
      WHERE LOWER(TRIM("trainee email")) = ANY($3::text[])
      RETURNING "trainee id", "trainee email", "trainee full name"
    `;
    updateParams = [cleanTargetId, finalTargetName, cleanEmails];
  } else if (sourceOrgId) {
    updateSql = `
      UPDATE public."pdc_trainee general profile"
      SET "trainee organization id" = $1,
          "trainee organization new" = $2,
          "user updated datetime" = NOW()
      WHERE LOWER(TRIM("trainee organization id")) = LOWER(TRIM($3))
      RETURNING "trainee id", "trainee email", "trainee full name"
    `;
    updateParams = [cleanTargetId, finalTargetName, sourceOrgId];
  } else if (sourceOrgName) {
    updateSql = `
      UPDATE public."pdc_trainee general profile"
      SET "trainee organization id" = $1,
          "trainee organization new" = $2,
          "user updated datetime" = NOW()
      WHERE LOWER(TRIM("trainee organization new")) = LOWER(TRIM($3))
      RETURNING "trainee id", "trainee email", "trainee full name"
    `;
    updateParams = [cleanTargetId, finalTargetName, sourceOrgName];
  } else {
    throw new Error("Must provide sourceOrgId, sourceOrgName, or traineeEmails.");
  }

  const updateRes = await queryPostgres(env, updateSql, updateParams);
  const updatedRows = updateRes.rows || [];

  // If a pending organization row is associated and should be verified
  const pdIdToUpdate = pendingPdId || sourceOrgId;
  if (markPendingVerified && pdIdToUpdate && String(pdIdToUpdate).startsWith("pd_")) {
    try {
      await queryPostgres(env, `
        UPDATE public.pdc_pending_organizations
        SET "status" = 'verified'
        WHERE LOWER(TRIM("pd_id")) = LOWER(TRIM($1))
      `, [pdIdToUpdate]);
    } catch (_) {}
  }

  return {
    ok: true,
    updatedCount: updatedRows.length,
    updatedTrainees: updatedRows.map(r => ({ email: r["trainee email"], fullName: r["trainee full name"] })),
    targetCompanyId: cleanTargetId,
    targetCompanyName: finalTargetName
  };
}
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
