// Generic PostgreSQL adapter for PD One-Stop.
// Purpose: one reusable DB layer for all table-level repositories.
// Business rules must stay in repo/service files, not here.

import { getTablePsqlName, quoteIdentifierPath } from "./data-source.js";
import { queryPostgres } from "./postgres.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function normalizeColumnName(name) {
  return String(name || "").trim();
}

export function quoteColumn(name) {
  const clean = normalizeColumnName(name);
  if (!clean) throw new Error("Missing PostgreSQL column name.");
  return quoteIdentifierPath(clean, "PostgreSQL column name");
}

export function quoteTableForKey(env, tableKey) {
  return quoteIdentifierPath(getTablePsqlName(env, tableKey), `${tableKey} PostgreSQL table`);
}

export function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function buildWhereClause(where = {}, startIndex = 1) {
  const entries = Object.entries(where || {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return { sql: "", values: [], nextIndex: startIndex };

  const parts = [];
  const values = [];
  let idx = startIndex;
  for (const [column, value] of entries) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        parts.push("FALSE");
        continue;
      }
      const placeholders = value.map((v) => {
        values.push(v);
        return `$${idx++}`;
      });
      parts.push(`${quoteColumn(column)} IN (${placeholders.join(", ")})`);
    } else if (value === null) {
      parts.push(`${quoteColumn(column)} IS NULL`);
    } else {
      values.push(value);
      parts.push(`${quoteColumn(column)} = $${idx++}`);
    }
  }

  return { sql: `WHERE ${parts.join(" AND ")}`, values, nextIndex: idx };
}

export function buildOrderBy(orderBy = []) {
  const arr = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = arr
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return `${quoteColumn(item)} ASC`;
      const column = item.column || item.name;
      if (!column) return "";
      const direction = String(item.direction || item.dir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
      return `${quoteColumn(column)} ${direction}`;
    })
    .filter(Boolean);
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}

export async function psqlSelectRows(env, tableKey, options = {}) {
  const table = quoteTableForKey(env, tableKey);
  const columns = Array.isArray(options.columns) && options.columns.length
    ? options.columns.map((c) => quoteColumn(c)).join(", ")
    : "*";
  const where = buildWhereClause(options.where || {});
  const orderBy = buildOrderBy(options.orderBy || []);
  const limit = clampLimit(options.limit, DEFAULT_LIMIT);
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const bypass = options.bypassCache ? ` /* bypass=${Date.now()} */` : "";

  const sql = `SELECT ${columns} FROM ${table} ${where.sql} ${orderBy} LIMIT ${limit} OFFSET ${offset}${bypass}`;
  const result = await queryPostgres(env, sql, where.values);
  return result.rows || [];
}

export async function psqlFindOne(env, tableKey, where = {}, options = {}) {
  const rows = await psqlSelectRows(env, tableKey, { ...options, where, limit: 1 });
  return rows[0] || null;
}

export async function psqlCountRows(env, tableKey, where = {}) {
  const table = quoteTableForKey(env, tableKey);
  const clause = buildWhereClause(where);
  const sql = `SELECT COUNT(*)::int AS count FROM ${table} ${clause.sql}`;
  const result = await queryPostgres(env, sql, clause.values);
  return Number(result.rows?.[0]?.count || 0);
}

export async function psqlInsertRow(env, tableKey, data = {}, options = {}) {
  const entries = Object.entries(data || {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error(`No fields provided for insert into ${tableKey}.`);

  const table = quoteTableForKey(env, tableKey);
  const columns = entries.map(([column]) => quoteColumn(column)).join(", ");
  const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  const returning = options.returning === false ? "" : "RETURNING *";
  const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ${returning}`;
  const result = await queryPostgres(env, sql, values);
  return { rowCount: result.rowCount, row: result.rows?.[0] || null, rows: result.rows || [] };
}

export async function psqlUpdateRows(env, tableKey, where = {}, data = {}, options = {}) {
  const dataEntries = Object.entries(data || {}).filter(([, value]) => value !== undefined);
  if (dataEntries.length === 0) throw new Error(`No fields provided for update on ${tableKey}.`);
  if (!where || Object.keys(where).length === 0) throw new Error(`Refusing to update ${tableKey} without a WHERE clause.`);

  const table = quoteTableForKey(env, tableKey);
  const setParts = [];
  const values = [];
  let idx = 1;
  for (const [column, value] of dataEntries) {
    values.push(value);
    setParts.push(`${quoteColumn(column)} = $${idx++}`);
  }
  const whereClause = buildWhereClause(where, idx);
  const returning = options.returning === false ? "" : "RETURNING *";
  const sql = `UPDATE ${table} SET ${setParts.join(", ")} ${whereClause.sql} ${returning}`;
  const result = await queryPostgres(env, sql, [...values, ...whereClause.values]);
  return { rowCount: result.rowCount, row: result.rows?.[0] || null, rows: result.rows || [] };
}

export async function psqlUpsertByKey(env, tableKey, keyColumn, keyValue, data = {}, options = {}) {
  // Use native PostgreSQL INSERT ... ON CONFLICT DO UPDATE to avoid read-after-write race conditions.
  const allData = { ...data, [keyColumn]: keyValue };
  const entries = Object.entries(allData).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error(`No fields provided for upsert on ${tableKey}.`);

  const table = quoteTableForKey(env, tableKey);
  const columns = entries.map(([column]) => quoteColumn(column)).join(", ");
  const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
  const values = entries.map(([, value]) => value);

  // Filter out the primary key from the SET clause to prevent "multiple assignments to same column" 
  // or unnecessary updates to the PK.
  const setEntries = entries.filter(([column]) => column !== keyColumn);
  if (setEntries.length === 0) {
    // Edge case: if we only insert the PK and no other fields, we can DO NOTHING.
    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT (${quoteColumn(keyColumn)}) DO NOTHING RETURNING *`;
    const result = await queryPostgres(env, sql, values);
    return { action: "upsert", rowCount: result.rowCount, row: result.rows?.[0] || null, rows: result.rows || [] };
  }

  const setParts = setEntries.map(([column]) => `${quoteColumn(column)} = EXCLUDED.${quoteColumn(column)}`);
  const returning = options.returning === false ? "" : "RETURNING *";
  
  const sql = `
    INSERT INTO ${table} (${columns}) 
    VALUES (${placeholders}) 
    ON CONFLICT (${quoteColumn(keyColumn)}) 
    DO UPDATE SET ${setParts.join(", ")} 
    ${returning}
  `;
  
  const result = await queryPostgres(env, sql, values);
  return { action: "upsert", rowCount: result.rowCount, row: result.rows?.[0] || null, rows: result.rows || [] };
}

export async function psqlTableColumns(env, tableKey) {
  const raw = getTablePsqlName(env, tableKey);
  const parts = String(raw || "").split(".");
  const schema = parts.length === 2 ? parts[0] : "public";
  const table = parts.length === 2 ? parts[1] : parts[0];
  const sql = `
    SELECT column_name AS name, data_type AS type, is_nullable AS nullable, ordinal_position AS position
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position ASC
  `;
  const result = await queryPostgres(env, sql, [schema, table]);
  return result.rows || [];
}
