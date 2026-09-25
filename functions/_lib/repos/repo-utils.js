import { getTableSource } from "../data-source.js";

export function sourceFor(env, tableKey) {
  return getTableSource(env, tableKey);
}

export function isPsql(env, tableKey) {
  return sourceFor(env, tableKey) === "psql";
}

export function requirePsqlSource(env, tableKey) {
  const source = sourceFor(env, tableKey);
  if (source !== "psql") throw new Error(`${tableKey} source is '${source}', not 'psql'.`);
  return source;
}

export function psqlNotImplemented(tableKey, operation) {
  const err = new Error(`${tableKey} PostgreSQL adapter scaffold exists, but operation '${operation}' is not wired to production routes yet.`);
  err.code = "PSQL_ADAPTER_NOT_WIRED";
  err.tableKey = tableKey;
  err.operation = operation;
  return err;
}

export function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function nowIso() {
  return new Date().toISOString();
}

export function nowVietnamLocal() {
  return formatVietnamLocal(new Date());
}

export function objectPick(data = {}, allowed = []) {
  const out = {};
  for (const key of allowed) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

export function formatVietnamDateTime(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function parsePsqlVietnamDate(value, fallbackStr, isEndDate = false) {
  if (!value) return new Date(fallbackStr);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date(fallbackStr);
  
  if (isEndDate) d.setUTCHours(23, 59, 59, 999);
  else if (value && !String(value).includes(":")) d.setUTCHours(0, 0, 0, 0);

  // The database string has no timezone, so Cloudflare parses it as UTC.
  // E.g. "10:17" -> 10:17 UTC. We shift it back 7 hours so when the frontend 
  // adds 7 hours for Vietnam time, it returns to exactly 10:17.
  d.setUTCHours(d.getUTCHours() - 7);
  return d;
}

export function formatVietnamLocal(date) {
  const d = date || new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).formatToParts(d).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
