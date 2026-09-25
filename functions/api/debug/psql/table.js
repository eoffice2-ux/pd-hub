import { jsonResponse, requireDebugToken } from "../../../_lib/security.js";
import { TABLES, describeTable, getTablePsqlName, quoteIdentifierPath } from "../../../_lib/data-source.js";
import { assertPostgresEnv, queryPostgres, enhancePostgresError } from "../../../_lib/postgres.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function normalizeTableKey(value) {
  return String(value || "").trim().toUpperCase();
}

function splitTablePath(tableName) {
  const raw = String(tableName || "").trim();
  const parts = raw.split(".");
  if (parts.length === 1) return { schema: "public", table: parts[0] };
  return { schema: parts[0], table: parts.slice(1).join(".") };
}

function maskValue(value) {
  if (value == null) return value;
  const s = String(value);
  if (s.length <= 80) return value;
  return s.slice(0, 77) + "...";
}

function maskRow(row = {}) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const k = String(key).toLowerCase();
    if (k.includes("password") || k.includes("secret") || k.includes("token") || k.includes("private_key")) {
      out[key] = "***masked***";
    } else {
      out[key] = maskValue(value);
    }
  }
  return out;
}

async function inspectOneTable(env, tableKey, options = {}) {
  const key = normalizeTableKey(tableKey);
  if (!TABLES[key]) throw new Error(`Unknown table key: ${tableKey}`);

  const psqlName = getTablePsqlName(env, key);
  const quotedTable = quoteIdentifierPath(psqlName, `TAB_${key}_PSQL`);
  const { schema, table } = splitTablePath(psqlName);

  const columnsResult = await queryPostgres(env, `
    SELECT
      column_name,
      data_type,
      is_nullable,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, table]);

  const exists = columnsResult.rows.length > 0;
  let rowCount = null;
  let sample = [];

  if (exists) {
    const countResult = await queryPostgres(env, `SELECT COUNT(*)::int AS row_count FROM ${quotedTable}`);
    rowCount = countResult.rows?.[0]?.row_count ?? null;

    if (options.sample) {
      const limit = Math.min(Math.max(Number(options.limit || 3), 1), 10);
      const sampleResult = await queryPostgres(env, `SELECT * FROM ${quotedTable} LIMIT ${limit}`);
      sample = (sampleResult.rows || []).map(maskRow);
    }
  }

  return {
    ...describeTable(env, key),
    psqlName,
    exists,
    schema,
    table,
    columnCount: columnsResult.rows.length,
    columns: columnsResult.rows.map((c) => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === "YES",
      position: c.ordinal_position
    })),
    rowCount,
    sampleCount: sample.length,
    sample
  };
}

export async function onRequestGet({ request, env }) {
  const debugAuth = requireDebugToken(request, env);
  if (!debugAuth.ok) return debugAuth.response;

  const url = new URL(request.url);
  const key = normalizeTableKey(url.searchParams.get("key") || url.searchParams.get("table") || "");
  const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
  const sample = url.searchParams.get("sample") === "1" || url.searchParams.get("sample") === "true";
  const limit = Number(url.searchParams.get("limit") || 3);

  const missing = assertPostgresEnv(env);
  if (missing.length) {
    return json({ success: false, psqlConfigured: false, missing }, 500);
  }

  try {
    if (all) {
      const results = [];
      for (const tableKey of Object.keys(TABLES)) {
        try {
          results.push(await inspectOneTable(env, tableKey, { sample: false, limit: 0 }));
        } catch (err) {
          const e = enhancePostgresError(err);
          results.push({ tableKey, success: false, error: e.message, code: e.code, hint: e.hint, ...describeTable(env, tableKey) });
        }
      }
      return json({ success: true, mode: "all", tableCount: results.length, results });
    }

    if (!key) {
      return json({
        success: false,
        error: "Missing table key. Use ?key=ORGANIZATION or ?all=1.",
        availableKeys: Object.keys(TABLES)
      }, 400);
    }

    const result = await inspectOneTable(env, key, { sample, limit });
    return json({ success: true, result });
  } catch (err) {
    const e = enhancePostgresError(err);
    return json({
      success: false,
      tableKey: key || null,
      error: e.message,
      code: e.code,
      hint: e.hint
    }, 500);
  }
}
