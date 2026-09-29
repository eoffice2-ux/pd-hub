import { jsonResponse, requireTraineeSession, readJson } from "../../../_lib/security.js";
import { queryPostgres } from "../../../_lib/postgres.js";
import { getTablePsqlName, quoteIdentifierPath } from "../../../_lib/data-source.js";

export function generatePendingOrgId(name) {
  const slug = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `pd_${slug}` : `pd_${Date.now()}`;
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  const auth = await requireTraineeSession(request, env);
  if (!auth.ok) return auth.response;

  const bodyReq = await readJson(request);
  if (!bodyReq.ok) return jsonResponse({ success: false, error: bodyReq.error }, 400);

  const name = String(bodyReq.data?.name || "").trim();
  if (name.length < 2) {
    return jsonResponse({ success: false, error: "Organization name is too short (minimum 2 characters)." }, 400);
  }

  const pdId = generatePendingOrgId(name);
  const tableName = quoteIdentifierPath(
    getTablePsqlName(env, "PENDING_ORG") || "public.pdc_pending_organizations",
    "pending organization PostgreSQL table"
  );

  try {
    await queryPostgres(env, `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        "pd_id"        VARCHAR(255) PRIMARY KEY,
        "name"         TEXT NOT NULL,
        "submitted_by" VARCHAR(255),
        "created_at"   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "status"       VARCHAR(50) DEFAULT 'pending'
      )
    `);

    await queryPostgres(env, `
      INSERT INTO ${tableName} ("pd_id", "name", "submitted_by", "created_at", "status")
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'pending')
      ON CONFLICT ("pd_id") DO NOTHING
    `, [pdId, name, auth.session.email || ""]);

    return jsonResponse({
      success: true,
      pd_id: pdId,
      name: name
    });
  } catch (err) {
    console.error("Failed to register pending organization:", err);
    return jsonResponse({
      success: false,
      error: "Failed to register organization: " + (err?.message || String(err))
    }, 500);
  }
}
