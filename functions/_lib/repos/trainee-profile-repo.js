import { psqlFindOne, psqlInsertRow, psqlUpdateRows, psqlUpsertByKey } from "../psql-adapter.js";
import { cleanEmail, objectPick, nowVietnamLocal } from "./repo-utils.js";
import { queryPostgres } from "../postgres.js";

export async function getTraineeProfilePsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const byEmail = await psqlFindOne(env, "TRAINEE_PROFILE", { "trainee email": clean }, options);
  if (byEmail) return byEmail;
  return psqlFindOne(env, "TRAINEE_PROFILE", { "trainee id": clean }, options);
}

export async function getTraineeAccessTypePsql(env, email) {
  const row = await getTraineeProfilePsql(env, email);
  if (!row) return { exists: false, hasPin: false };
  return { exists: true, hasPin: String(row["trainee pin"] || "").trim() !== "" };
}

export async function verifyTraineePinPsql(env, email, pin) {
  const row = await getTraineeProfilePsql(env, email);
  if (!row) return { ok: false, reason: "not_found" };
  const expectedVal = row["trainee pin"];
  if (expectedVal === null || expectedVal === undefined || expectedVal === "") {
    return { ok: false, reason: "no_pin", row };
  }
  const expected = String(expectedVal).padStart(4, "0");
  const inputPin = String(pin || "").trim().padStart(4, "0");
  return { ok: expected === inputPin, row };
}

export async function setTraineePinPsql(env, email, pin, options = {}) {
  const clean = cleanEmail(email);
  
  const updateFields = {
    "trainee pin": String(pin || "").trim(),
    "trainee email": clean, // Ensure email is correctly kept
    "user updated datetime": options.updatedAt || nowVietnamLocal()
  };

  return psqlUpsertByKey(env, "TRAINEE_PROFILE", "trainee id", clean, updateFields, options);
}

export async function updateTraineeProfilePsql(env, email, data = {}, options = {}) {
  const clean = cleanEmail(email);
  const allowed = [
    "trainee full name", "trainee phone", "trainee gender", "trainee organization new",
    "trainee organization id", "trainee position", "trainee type", "user updated datetime",
    "school", "department"
  ];
  
  const updateFields = objectPick(data, allowed);
  // Also ensure the trainee email is included in case it's a completely new row.
  updateFields["trainee email"] = clean;

  return psqlUpsertByKey(env, "TRAINEE_PROFILE", "trainee id", clean, updateFields, options);
}

export async function updateTraineeProfileFromUiPsql(env, email, data = {}, options = {}) {
  return updateTraineeProfilePsql(env, email, {
    "trainee full name": data.fullName,
    "trainee phone": data.phone,
    "trainee gender": data.gender,
    "trainee organization new": data.organization,
    "trainee organization id": data.organizationId,
    "trainee position": data.position,
    "trainee type": data.traineeType,
    "school": data.school,
    "department": data.department,
    "user updated datetime": options.updatedAt || nowVietnamLocal()
  }, options);
}

export async function getSchoolsPsql(env) {
  const result = await queryPostgres(env, "SELECT id, name, school_office_type FROM public.setting_school_office ORDER BY name", []);
  return result.rows || [];
}

export async function getProgramsPsql(env, schoolId) {
  if (!schoolId) return [];
  const result = await queryPostgres(env, "SELECT id, program_function FROM public.setting_school_program WHERE school_office_id = $1 ORDER BY program_function", [schoolId]);
  return result.rows || [];
}

