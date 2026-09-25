import { psqlFindOne, psqlInsertRow, psqlSelectRows } from "../psql-adapter.js";
import { cleanEmail, formatVietnamDateTime, nowVietnamLocal, parsePsqlVietnamDate } from "./repo-utils.js";
import { getSectionPsql, getSectionDetailsPsql } from "./section-repo.js";
import { getUserType } from "../trainee-gsheet.js";
import { listCheckinPlansForSectionPsql, listCheckinLogsForTraineePsql } from "./checkin-repo.js";
import { listFeedbackFormsForSectionPsql, getFeedbackSubmissionPsql } from "./feedback-repo.js";
import { getTraineeProfilePsql } from "./trainee-profile-repo.js";

// Fields that must be non-empty for a profile to be considered complete.
const REQUIRED_PROFILE_FIELDS = [
  "trainee full name",
  "trainee gender",
  "trainee phone",
  "trainee organization new",
  "trainee position"
];

function isProfileComplete(row) {
  if (!row) return false;
  return REQUIRED_PROFILE_FIELDS.every(f => String(row[f] || "").trim() !== "");
}

export async function getRegistrationPsql(env, email, sectionId, options = {}) {
  return psqlFindOne(env, "SECTION_ATTENDEE", {
    "trainee id": cleanEmail(email),
    "section id": String(sectionId || "").trim()
  }, options);
}

export async function listRegistrationsForTraineePsql(env, email, options = {}) {
  return psqlSelectRows(env, "SECTION_ATTENDEE", {
    where: { "trainee id": cleanEmail(email) },
    limit: options.limit || 500
  });
}

export async function listActiveRegistrationsForSectionPsql(env, sectionId, options = {}) {
  const rows = await psqlSelectRows(env, "SECTION_ATTENDEE", {
    where: { "section id": String(sectionId || "").trim() },
    limit: options.limit || 1000
  });
  
  // Filter out withdrawn trainees
  return rows.filter(r => String(r["registration status"] || "").trim().toLowerCase() !== "withdrawn");
}

export async function insertRegistrationPsql(env, email, sectionId, data = {}, options = {}) {
  const clean = cleanEmail(email);
  const sid = String(sectionId || "").trim();
  const existing = await getRegistrationPsql(env, clean, sid, { bypassCache: true });
  if (existing) return { action: "existing", row: existing, rowCount: 0 };
  
  const payload = {
    "section attendee id": data["section attendee id"] || `${sid}-${clean}`,
    "section id": sid,
    "trainee id": clean,
    "registered at": data["registered at"] || data["registered datetime"] || nowVietnamLocal()
  };
  if (data["section name"]) payload["section name"] = data["section name"];
  if (data["course id"]) payload["course id"] = data["course id"];
  
  return psqlInsertRow(env, "SECTION_ATTENDEE", payload, options);
}

export async function registerTraineeForSectionPsql(env, email, sectionId, dryRun = true) {
  const clean = cleanEmail(email);
  const safeSectionId = String(sectionId || "").trim();
  
  const section = await getSectionPsql(env, safeSectionId);
  if (!section) {
    return { status: "Error", message: "Section not found", sectionId: safeSectionId, registered: false, googleUpdatedCells: 0 };
  }
  
  const isDup = await getRegistrationPsql(env, clean, safeSectionId, { bypassCache: true });
  if (isDup) {
    return { status: "Already Registered", message: "Already Registered", sectionId: safeSectionId, registered: true, duplicate: true, googleUpdatedCells: 0 };
  }

  // Capacity check
  const maxParticipants = parseInt(section["no of participant"]) || 0;
  if (maxParticipants > 0) {
    const activeRegistrations = await listActiveRegistrationsForSectionPsql(env, safeSectionId);
    if (activeRegistrations.length >= maxParticipants) {
      return { 
        status: "Section Full", 
        message: "This section has reached its maximum participant limit.", 
        sectionId: safeSectionId, 
        registered: false, 
        googleUpdatedCells: 0 
      };
    }
  }

  // Profile completeness check — all mandatory fields must be filled.
  const profile = await getTraineeProfilePsql(env, clean);
  if (!isProfileComplete(profile)) {
    return {
      status: "Forbidden",
      message: "Please complete your profile before registering for a course. All mandatory fields (Full Name, Gender, Phone, Organization, Position) must be filled.",
      sectionId: safeSectionId,
      registered: false,
      googleUpdatedCells: 0
    };
  }
  
  const userType = getUserType(clean);
  const sectionType = String(section["section type"] || section["section trainee type"] || section["section_type"] || "").toLowerCase().trim();
  let typeMatch = false;
  if (userType === "Industry") typeMatch = sectionType === "industry";
  else if (userType === "Staff") typeMatch = sectionType === "eiu staff";
  else if (userType === "Student") typeMatch = sectionType === "student";
  if (!typeMatch) {
    return { status: "Forbidden", message: `This section is not available for user type ${userType}.`, sectionId: safeSectionId, registered: false, googleUpdatedCells: 0 };
  }
  
  const rawStatus = String(section["section status"] || section["status"] || "").toLowerCase().trim();
  const startRegVal = section["date start registration"] || section["start_reg"];
  const endRegVal = section["date end registration"] || section["end_reg"];
  const startReg = parsePsqlVietnamDate(startRegVal, "2000-01-01T00:00:00Z", false);
  const endReg = parsePsqlVietnamDate(endRegVal, "2099-12-31T23:59:59Z", true);
  
  const now = new Date();
  const SECTION_ALLOW_REGISTRATION = ["registration open", "in progress"];
  const isOpenByStatus = SECTION_ALLOW_REGISTRATION.includes(rawStatus);
  const isOpenByDate = now >= startReg && now <= endReg;
  
  if (!isOpenByStatus || !isOpenByDate) {
    return {
      status: "Registration Closed",
      message: "This section is not currently open for registration.",
      sectionId: safeSectionId,
      registered: false,
      rawStatus,
      isOpenByStatus,
      isOpenByDate,
      googleUpdatedCells: 0
    };
  }
  
  let dbResult = null;
  if (!dryRun) {
    dbResult = await insertRegistrationPsql(env, clean, safeSectionId, {
      "section attendee id": `${safeSectionId}-${clean}`,
      "section name": section["section name en"] || section["name_en"] || "",
      "course id": section["course id"] || section["course_id"] || "",
      "registered datetime": nowVietnamLocal()
    });
  }
  
  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No registration row was appended." : "Success",
    sectionId: safeSectionId,
    traineeEmail: clean,
    registered: !dryRun,
    dryRun,
    updatedFields: ["section attendee id", "section id", "section name", "course id", "trainee id", "registered datetime"],
    updatedCellCount: 6,
    googleUpdatedCells: dbResult ? 1 : 0,
    section
  };
}

export async function getTraineeHistoryPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  
  const registrations = await listRegistrationsForTraineePsql(env, clean, options);
  if (registrations.length === 0) {
    return { count: 0, data: [] };
  }
  
  const data = [];
  
  for (const reg of registrations) {
    const sectionId = String(reg["section id"] || reg["section_id"] || "").trim();
    if (!sectionId) continue;
    
    const details = await getSectionDetailsPsql(env, sectionId);
    if (!details) continue;
    
    const { section, course } = details;
    const courseName = course ? (course["course name en"] || course["course name"] || "") : "";
    const sectionNameEn = courseName || section["section name en"] || sectionId;
    
    const plans = await listCheckinPlansForSectionPsql(env, sectionId);
    const logs = await listCheckinLogsForTraineePsql(env, clean, sectionId);
    const checkinText = `${logs.length} / ${plans.length} (${plans.length > 0 ? Math.round((logs.length / plans.length) * 100) : 0}%)`;
    
    const forms = await listFeedbackFormsForSectionPsql(env, sectionId);
    let submittedCount = 0;
    for (const f of forms) {
      const formId = String(f["form id"] || f["form_id"] || "").trim();
      const mappingId = String(f["mapping id"] || f["mapping_id"] || "").trim();
      if (!formId || !mappingId) continue;
      const sub = await getFeedbackSubmissionPsql(env, formId, mappingId, clean);
      if (sub) submittedCount++;
    }
    const feedbackText = `${submittedCount} / ${forms.length} (${forms.length > 0 ? Math.round((submittedCount / forms.length) * 100) : 0}%)`;
    
    const regDateStr = reg["registered at"] || reg["registered datetime"] || reg["registered_at"] || "";
    let registeredAt = "N/A";
    if (regDateStr) {
      const regDate = new Date(regDateStr);
      registeredAt = formatVietnamDateTime(regDate);
    }
    
    data.push({
      sectionId,
      sectionNameEn,
      status: section["section status"] || section["status"] || "Unknown",
      sectionDate: section["section date"] || section["date"] || "N/A",
      registeredAt,
      checkin: checkinText,
      assessment: "N/A",
      feedback: feedbackText,
      certIssued: reg["certificate status"] || reg["certificate_status"] || ""
    });
  }
  
  return { count: data.length, data };
}
