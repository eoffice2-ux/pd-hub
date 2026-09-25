import { psqlFindOne, psqlSelectRows } from "../psql-adapter.js";
import { cleanEmail, parsePsqlVietnamDate, isPsql } from "./repo-utils.js";

export async function getSectionPsql(env, sectionId) {
  return psqlFindOne(env, "SECTION", { "section id": String(sectionId || "").trim() });
}

export async function listSectionsPsql(env, options = {}) {
  return psqlSelectRows(env, "SECTION", {
    limit: options.limit || 500,
    orderBy: options.orderBy || [{ column: "section id", direction: "DESC" }]
  });
}

export async function getCoursePsql(env, courseId) {
  return psqlFindOne(env, "COURSE_MASTER", { "course id": String(courseId || "").trim() });
}

export async function getVenuePsql(env, venueId) {
  return psqlFindOne(env, "VENUE", { "facility id": String(venueId || "").trim() });
}

export async function getRegisteredSectionsForTraineePsql(env, email, options = {}) {
  return psqlSelectRows(env, "SECTION_ATTENDEE", {
    where: { "trainee id": cleanEmail(email) },
    limit: options.limit || 500
  });
}

import { getUserType } from "../trainee-gsheet.js";

export async function getSectionDetailsPsql(env, sectionId) {
  const section = await getSectionPsql(env, sectionId);
  if (!section) return null;
  const courseId = section["course id"] || section["course_id"] || "";
  const roomId = section["section room id"] || section["room id"] || section["room_id"] || "";
  const [course, venue] = await Promise.all([
    getCourseHelper(env, courseId),
    getVenueHelper(env, roomId)
  ]);
  return { section, course, venue };
}



export async function getTraineeSectionsPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const userType = getUserType(clean);

  const sections = await listSectionsPsql(env, options);
  const registrations = await getRegisteredSectionsForTraineePsql(env, clean, options);
  const registeredIds = new Set(registrations.map(r => String(r["section id"] || r["section_id"] || "").trim()));

  const SECTION_ALLOW_VIEW = ["registration open", "registration closed", "in progress"];
  const SECTION_ALLOW_REGISTRATION = ["registration open", "in progress"];

  const now = new Date();
  const data = [];

  for (const s of sections) {
    const sectionId = String(s["section id"] || s["section_id"] || "").trim();
    if (!sectionId) continue;

    const rawStatus = String(s["section status"] || s["status"] || "").toLowerCase().trim();
    if (!SECTION_ALLOW_VIEW.includes(rawStatus)) continue;

    const sectionType = String(s["section type"] || s["section trainee type"] || s["section_type"] || "").toLowerCase().trim();
    let typeMatch = false;
    if (userType === "Industry") typeMatch = sectionType === "industry";
    else if (userType === "Staff") typeMatch = sectionType === "eiu staff";
    else if (userType === "Student") typeMatch = sectionType === "student";
    if (!typeMatch) continue;

    const startReg = parsePsqlVietnamDate(s["date start registration"] || s["start_reg"] || "", "2000-01-01T00:00:00Z", false);
    const endReg = parsePsqlVietnamDate(s["date end registration"] || s["end_reg"] || "", "2099-12-31T23:59:59Z", true);
    const isRegistered = registeredIds.has(sectionId);

    let displayStatus = "";
    let maxParticipants = parseInt(s["no of participant"]) || 0;
    let currentCount = null;

    if (maxParticipants > 0) {
      // Fetch active count directly to avoid circular dependency with registration-repo
      const activeRows = await psqlSelectRows(env, "SECTION_ATTENDEE", {
        where: { "section id": sectionId },
        limit: 1000,
        bypassCache: options.bypassCache
      });
      currentCount = activeRows.filter(r => String(r["registration status"] || "").trim().toLowerCase() !== "withdrawn").length;
    }

    if (isRegistered) displayStatus = "Registered";
    else if (now < startReg) displayStatus = "Not Open for registration yet";
    else if (now > endReg) displayStatus = "Missed";
    else if (SECTION_ALLOW_REGISTRATION.includes(rawStatus)) {
      if (maxParticipants > 0 && currentCount >= maxParticipants) {
        displayStatus = "Section Full";
      } else {
        displayStatus = "Open for registration";
      }
    }
    else displayStatus = "Registration Closed";

    data.push({
      id: sectionId,
      name: String(s["section name en"] || s["name_en"] || sectionId),
      date: String(s["section date"] || s["date"] || "N/A").replace(/\n/g, "<br>"),
      venue: String(s["section venue"] || s["venue"] || ""),
      status: displayStatus,
      isRegistered,
      maxParticipants,
      currentCount
    });
  }

  return { userType, registeredCount: registeredIds.size, data };
}

export async function getTraineeActiveSectionsPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const registrations = await getRegisteredSectionsForTraineePsql(env, clean, options);
  const registeredIds = new Set(registrations.map(r => String(r["section id"] || r["section_id"] || "").trim()));
  
  if (registeredIds.size === 0) {
    return { registeredCount: 0, data: [] };
  }
  
  const sections = await listSectionsPsql(env, options);
  const allowedStatuses = new Set(["registration open", "registration closed", "in progress", "post training evaluation"]);
  const activeSections = [];
  
  for (const s of sections) {
    const sectionId = String(s["section id"] || s["section_id"] || "").trim();
    if (!sectionId || !registeredIds.has(sectionId)) continue;
    
    const rawStatus = String(s["section status"] || s["status"] || "").toLowerCase().trim();
    if (!allowedStatuses.has(rawStatus)) continue;
    
    const courseId = s["course id"] || s["course_id"] || "";
    const sectionName = s["section name en"] || s["name_en"] || "";
    
    let courseName = courseId || sectionId;
    if (courseId) {
      const course = await getCourseHelper(env, courseId);
      if (course) {
        courseName = course["course name en"] || course["course name"] || courseName;
      }
    }
    
    activeSections.push({
      sectionId,
      courseName: sectionName || courseName || sectionId,
      status: s["section status"] || s["status"] || "Unknown",
      date: String(s["section date"] || s["date"] || "N/A").replace(/\n/g, "<br>")
    });
  }
  
  return { registeredCount: registeredIds.size, data: activeSections };
}

export async function getCourseHelper(env, courseId) {
  if (!courseId) return null;
  if (isPsql(env, "COURSE_MASTER")) {
    return getCoursePsql(env, courseId);
  }
  try {
    const spreadsheetId = env.GOOGLE_SHEET_ID_CORE;
    if (!spreadsheetId) return null;
    const { getSheetValues } = await import("../google-sheets.js");
    const { getTableSheetName } = await import("../data-source.js");
    const sheetName = getTableSheetName(env, "COURSE_MASTER") || "pdc_course master list";
    const result = await getSheetValues(env, spreadsheetId, `${sheetName}!A:ZZ`);
    const values = result.values || [];
    if (values.length < 1) return null;
    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const courseIdIdx = headers.indexOf("course id");
    if (courseIdIdx === -1) return null;
    const row = values.slice(1).find(r => String(r[courseIdIdx] || "").trim() === String(courseId).trim());
    if (!row) return null;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    return obj;
  } catch (e) {
    console.error("Failed to fetch course from GSheet", e);
    return null;
  }
}

export async function getVenueHelper(env, venueId) {
  if (!venueId) return null;
  if (isPsql(env, "VENUE")) {
    return getVenuePsql(env, venueId);
  }
  try {
    const spreadsheetId = env.GOOGLE_SHEET_ID_CORE;
    if (!spreadsheetId) return null;
    const { getSheetValues } = await import("../google-sheets.js");
    const { getTableSheetName } = await import("../data-source.js");
    const sheetName = getTableSheetName(env, "VENUE") || "pdc-room lab management";
    const result = await getSheetValues(env, spreadsheetId, `${sheetName}!A:ZZ`);
    const values = result.values || [];
    if (values.length < 1) return null;
    const headers = values[0].map(h => String(h || "").toLowerCase().trim());
    const facilityIdIdx = headers.indexOf("facility id") !== -1 ? headers.indexOf("facility id") : headers.indexOf("room id");
    if (facilityIdIdx === -1) return null;
    const row = values.slice(1).find(r => String(r[facilityIdIdx] || "").trim() === String(venueId).trim());
    if (!row) return null;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    return obj;
  } catch (e) {
    console.error("Failed to fetch venue from GSheet", e);
    return null;
  }
}
