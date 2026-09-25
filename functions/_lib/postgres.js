// PostgreSQL helper for Cloudflare Pages Functions / Workers.
// Preferred production mode: Cloudflare Hyperdrive binding.
// Fallback: DATABASE_URL / POSTGRES_URL secret.
// Requires pg >= 8.13 and nodejs_compat when this module is imported by active routes.

import { Client } from "pg";
import { quoteIdentifierPath } from "./data-source.js";

export function getPostgresConnectionString(env = {}) {
  if (env.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString;
  return String(env.DATABASE_URL || env.POSTGRES_URL || env.PSQL_DATABASE_URL || "").trim();
}

export function assertPostgresEnv(env = {}) {
  const missing = [];
  if (!getPostgresConnectionString(env)) missing.push("HYPERDRIVE binding or DATABASE_URL/POSTGRES_URL");
  return missing;
}

export function getPostgresClientOptions(env = {}) {
  const connectionString = getPostgresConnectionString(env);
  if (!connectionString) {
    throw new Error("Missing PostgreSQL connection string. Set Hyperdrive binding HYPERDRIVE or DATABASE_URL/POSTGRES_URL secret.");
  }

  const connectionTimeoutMillis = Number(env.PSQL_CONNECT_TIMEOUT_MS || 8000);
  const query_timeout = Number(env.PSQL_QUERY_TIMEOUT_MS || 10000);
  const statement_timeout = Number(env.PSQL_STATEMENT_TIMEOUT_MS || 10000);
  const idle_in_transaction_session_timeout = Number(env.PSQL_IDLE_TX_TIMEOUT_MS || 10000);
  const application_name = String(env.PSQL_APPLICATION_NAME || "pd-onestop-cloudflare").slice(0, 60);

  return {
    connectionString,
    connectionTimeoutMillis,
    query_timeout,
    statement_timeout,
    idle_in_transaction_session_timeout,
    application_name,
    keepAlive: false
  };
}

export async function withPostgresClient(env, callback) {
  const client = new Client(getPostgresClientOptions(env));
  try {
    await client.connect();
    return await callback(client);
  } catch (err) {
    const enhanced = enhancePostgresError(err);
    throw enhanced;
  } finally {
    try {
      await client.end();
    } catch (_) {
      // Ignore close errors. The original query/connect error is more useful.
    }
  }
}

export async function queryPostgres(env, text, values = []) {
  return withPostgresClient(env, async (client) => {
    const result = await client.query(text, values);
    return { rows: result.rows || [], rowCount: result.rowCount || 0 };
  });
}

export async function testPostgresConnection(env) {
  const startedAt = Date.now();
  return withPostgresClient(env, async (client) => {
    const result = await client.query("SELECT now() AS server_time, current_database() AS database_name, current_schema() AS schema_name");
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      row: result.rows?.[0] || null
    };
  });
}

export function quotePsqlTableName(tableName) {
  return quoteIdentifierPath(tableName, "PostgreSQL table name");
}

export function enhancePostgresError(err) {
  const originalMessage = err?.message || String(err);
  const message = originalMessage.replace(/postgresql:\/\/[^\s@/]+:[^\s@/]+@/gi, "postgresql://***:***@");
  const code = err?.code || err?.errno || "PSQL_ERROR";
  const hint = inferPostgresHint(message, code);
  const enhanced = new Error(message);
  enhanced.name = "PostgresConnectionError";
  enhanced.code = code;
  enhanced.hint = hint;
  enhanced.original = err;
  return enhanced;
}

export function inferPostgresHint(message = "", code = "") {
  const m = String(message || "").toLowerCase();
  if (m.includes("connection terminated unexpectedly")) {
    return "The TCP connection was opened then closed unexpectedly. Check SSL mode, PgBouncer/proxy settings, VPS firewall/pg_hba.conf, and consider Cloudflare Hyperdrive for production.";
  }
  if (m.includes("timeout") || code === "ETIMEDOUT") {
    return "Connection timed out. Check VPS firewall, public port, listen_addresses, pg_hba.conf, and whether Cloudflare can reach the PostgreSQL host.";
  }
  if (m.includes("ssl") || m.includes("tls")) {
    return "SSL/TLS mismatch. If PostgreSQL does not support SSL, remove sslmode=require. If it requires SSL, keep sslmode=require and verify the server certificate/proxy supports TLS.";
  }
  if (m.includes("password authentication failed") || code === "28P01") {
    return "Authentication failed. Check DATABASE_URL username/password and rotate the password if it was exposed.";
  }
  if (m.includes("no pg_hba.conf entry")) {
    return "PostgreSQL rejected the remote client. Update pg_hba.conf to allow this user/database from external connections, preferably with SSL if required.";
  }
  if (m.includes("relation") && m.includes("does not exist")) {
    return "The PostgreSQL table name is not found. Check TAB_*_PSQL value, schema name, and quoted identifiers for names with spaces.";
  }
  if (m.includes("column") && m.includes("does not exist")) {
    return "The route expects specific column names. For Organization it currently expects company_id, company_name_GB, company_name_VN.";
  }
  return "Check DATABASE_URL, network reachability, PostgreSQL logs, and Cloudflare compatibility settings.";
}
