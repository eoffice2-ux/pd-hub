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

export function parseVietnamDateParts(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  // yyyy-mm-dd or yyyy/mm/dd
  let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };

  // dd/mm/yyyy, dd-mm-yyyy, dd/May/yyyy
  m = raw.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,}|\d{1,2})[-/\s](\d{4})/);
  if (m) {
    const monthToken = String(m[2]).toLowerCase();
    const months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
    const month = /^\d+$/.test(monthToken) ? Number(monthToken) : months[monthToken];
    return { year: Number(m[3]), month, day: Number(m[1]) };
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() };
  }

  return null;
}

export function parseTimeParts(value, fallbackEnd = false) {
  const raw = String(value || "").trim();
  if (!raw) return fallbackEnd ? { hour: 23, minute: 59, second: 59 } : { hour: 0, minute: 0, second: 0 };
  const m = raw.match(/(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const second = Number(m[3] || 0);
  const ampm = String(m[4] || "").toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

export function vietnamLocalToUtcMs(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 7, parts.minute, parts.second || 0);
}

export function calculateSlotEndTimestamp(dateValue, toValue) {
  if (!dateValue && !toValue) return 0;
  // If toValue is already a full datetime string
  const fullToParts = parseVietnamDateParts(toValue);
  if (fullToParts) {
    const toTimeMatch = String(toValue).match(/\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s*[AP]M)?)/i);
    const toTime = toTimeMatch ? parseTimeParts(toTimeMatch[1], true) : { hour: 23, minute: 59, second: 59 };
    return vietnamLocalToUtcMs({ ...fullToParts, ...(toTime || { hour: 23, minute: 59, second: 59 }) });
  }

  const dateParts = parseVietnamDateParts(dateValue);
  if (!dateParts) return 0;

  let toParts = parseTimeParts(toValue, false);
  if (!toParts) {
    const timeMatch = String(dateValue).match(/\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s*[AP]M)?)/i);
    if (timeMatch) {
      toParts = parseTimeParts(timeMatch[1], true);
    }
  }
  if (!toParts) {
    toParts = { hour: 23, minute: 59, second: 59 };
  }
  return vietnamLocalToUtcMs({ ...dateParts, ...toParts });
}
