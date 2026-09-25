import { psqlFindOne, psqlInsertRow, psqlSelectRows, psqlUpdateRows } from "../psql-adapter.js";
import { cleanEmail, objectPick } from "./repo-utils.js";

export async function getClientProfilePsql(env, email) {
  const clean = cleanEmail(email);
  return psqlFindOne(env, "CLIENT_PROFILE", { "client representative email": clean });
}

export async function updateClientProfilePsql(env, clientIdOrEmail, data = {}, options = {}) {
  const allowed = [
    "client representative", "client representative name", "client representative email",
    "client phone", "client organization", "client position", "user updated datetime", "updated by"
  ];
  const update = objectPick(data, allowed);
  const key = String(clientIdOrEmail || "").trim();
  const where = key.includes("@") ? { "client representative email": cleanEmail(key) } : { "client id": key };
  return psqlUpdateRows(env, "CLIENT_PROFILE", where, update, options);
}

export async function getClientInquiriesPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const limit = options.limit || 200;
  // Generic adapter supports AND where only; this route needs OR ownership.
  // Use a parameterized custom query when this repo is wired later.
  const rowsA = await psqlSelectRows(env, "CLIENT_INQUIRY", { where: { "client representative email": clean }, limit });
  const rowsB = await psqlSelectRows(env, "CLIENT_INQUIRY", { where: { "internal requester": clean }, limit });
  const seen = new Set();
  return [...rowsA, ...rowsB].filter((row) => {
    const id = String(row["inquiry id"] || JSON.stringify(row));
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function updateClientInquiryPsql(env, inquiryId, data = {}, options = {}) {
  const blocked = new Set([
    "inquiry id", "client id", "bd incharge", "inquiry created datetime", "inquiry status",
    "inquiry completed datetime", "inquiry completed by", "client representative",
    "client representative name", "client representative email", "internal requester"
  ]);
  const update = {};
  for (const [key, value] of Object.entries(data || {})) {
    const cleanKey = String(key || "").toLowerCase().trim();
    if (!blocked.has(cleanKey)) update[cleanKey] = value;
  }
  return psqlUpdateRows(env, "CLIENT_INQUIRY", { "inquiry id": String(inquiryId || "").trim() }, update, options);
}

export async function getClientInquiryPsql(env, inquiryId) {
  return psqlFindOne(env, "CLIENT_INQUIRY", { "inquiry id": String(inquiryId || "").trim() });
}

export async function insertClientInquiryPsql(env, data = {}, options = {}) {
  return psqlInsertRow(env, "CLIENT_INQUIRY", data, options);
}
