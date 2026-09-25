import { jsonResponse, requireAdminOrDebug, requireAdminSession, isAdminEmail, normalizeEmail } from "../../_lib/security.js";
import { getCoreSpreadsheetId, getFeedbackSpreadsheetId, getSheetValues, quoteSheetName } from "../../_lib/google-sheets.js";
import { getTableSource, getTableSheetName, getTablePsqlName, quoteIdentifierPath } from "../../_lib/data-source.js";
import { queryPostgres } from "../../_lib/postgres.js";
import { getUserRole } from "../../_lib/user-roles.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  // Allow: debug token, ADMIN_EMAILS env, role=admin, or role=report_viewer
  const debugAuth = await requireAdminOrDebug(request, env);
  if (!debugAuth.ok) {
    // Not admin/debug - check if they have report_viewer role
    const sessionAuth = await requireAdminSession(request, env);
    if (!sessionAuth.ok) return sessionAuth.response;
    const role = await getUserRole(env, sessionAuth.session.email);
    const isEnvAdmin = isAdminEmail(sessionAuth.session.email, env);
    if (!isEnvAdmin && role !== "admin" && role !== "report_viewer") {
      return jsonResponse({ success: false, error: "Forbidden. Requires admin or report_viewer role." }, 403);
    }
  }

  try {
    const spreadsheetId = getCoreSpreadsheetId(env);
    const feedbackSpreadsheetId = getFeedbackSpreadsheetId(env);

    if (!spreadsheetId) {
      throw new Error("Missing Core Spreadsheet ID.");
    }

    // Fetch core data in parallel
    const [secRes, regRes, checkinRes, checkinPlanRes, courseRes, venueRes, traineeRes] = await Promise.all([
      fetchTableAsMatrix(env, "SECTION", spreadsheetId),
      fetchTableAsMatrix(env, "SECTION_ATTENDEE", spreadsheetId),
      fetchTableAsMatrix(env, "CHECKIN_LOG", spreadsheetId),
      fetchTableAsMatrix(env, "CHECKIN_PLAN", spreadsheetId),
      fetchTableAsMatrix(env, "COURSE_MASTER", spreadsheetId),
      fetchTableAsMatrix(env, "VENUE", spreadsheetId),
      fetchTableAsMatrix(env, "TRAINEE_PROFILE", spreadsheetId)
    ]);

    // Fetch feedback data in parallel if feedbackSpreadsheetId is available
    let fbSecFormsRes = { values: [] };
    let fbSubmissionsRes = { values: [] };
    if (feedbackSpreadsheetId) {
      const fbData = await Promise.all([
        fetchTableAsMatrix(env, "FB_SECTIONFORMS", feedbackSpreadsheetId),
        fetchTableAsMatrix(env, "FB_SUBMISSIONS", feedbackSpreadsheetId)
      ]);
      fbSecFormsRes = fbData[0];
      fbSubmissionsRes = fbData[1];
    }

    const secValues = secRes.values || [];
    const regValues = regRes.values || [];
    const checkinValues = checkinRes.values || [];
    const checkinPlanValues = checkinPlanRes.values || [];
    const courseValues = courseRes.values || [];
    const venueValues = venueRes.values || [];
    const traineeValues = traineeRes.values || [];

    const fbSecFormsValues = fbSecFormsRes.values || [];
    const fbSubmissionsValues = fbSubmissionsRes.values || [];

    if (secValues.length === 0) {
      return jsonResponse({ success: false, error: "Section sheet is empty." }, 404);
    }

    // Helper to normalize header names
    const normalizeHeader = (h) => String(h || "").trim().toLowerCase();

    // Helper to find header index from multiple possible names
    const getHeaderIndex = (headers, keys) => {
      for (const key of keys) {
        const idx = headers.indexOf(key);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // Map headers
    const secHeaders = secValues[0].map(normalizeHeader);
    const regHeaders = regValues[0].map(normalizeHeader);
    const checkinHeaders = checkinValues[0].map(normalizeHeader);
    const checkinPlanHeaders = checkinPlanValues.length > 0 ? checkinPlanValues[0].map(normalizeHeader) : [];
    const courseHeaders = courseValues.length > 0 ? courseValues[0].map(normalizeHeader) : [];
    const venueHeaders = venueValues.length > 0 ? venueValues[0].map(normalizeHeader) : [];
    const traineeHeaders = traineeValues.length > 0 ? traineeValues[0].map(normalizeHeader) : [];

    const fbSecFormsHeaders = fbSecFormsValues.length > 0 ? fbSecFormsValues[0].map(normalizeHeader) : [];
    const fbSubmissionsHeaders = fbSubmissionsValues.length > 0 ? fbSubmissionsValues[0].map(normalizeHeader) : [];

    // Header indexes
    const secIdIdx = secHeaders.indexOf("section id");
    const secStatusIdx = secHeaders.indexOf("section status");
    const secCourseIdIdx = secHeaders.indexOf("course id");
    const secDateIdx = secHeaders.indexOf("section date");
    const secDateStartIdx = secHeaders.indexOf("date start");
    const secRoomIdIdx = secHeaders.indexOf("section room id") !== -1 ? secHeaders.indexOf("section room id") : secHeaders.indexOf("room id");

    const regSectionIdIdx = regHeaders.indexOf("section id");
    const regTraineeIdIdx = getHeaderIndex(regHeaders, ["trainee id", "trainee email"]);

    const checkinSectionIdIdx = checkinHeaders.indexOf("section id");
    const checkinTraineeIdIdx = getHeaderIndex(checkinHeaders, ["trainee id", "trainee email"]);
    const checkinSlotIdIdx = getHeaderIndex(checkinHeaders, ["checkin slot id", "slot id"]);
    const checkinTimestampIdx = getHeaderIndex(checkinHeaders, [
      "checkin time stamp", "checkin timestamp", "timestamp",
      "checkin datetime", "checkin_datetime",
      "checkin time", "checkin at", "checkin_at", "checked in at",
      "updated at", "updated_at"
    ]);

    const cpSectionIdIdx = checkinPlanHeaders.indexOf("section id");
    const cpSlotIdIdx = checkinPlanHeaders.indexOf("checkin slot id");
    const cpDateIdx = checkinPlanHeaders.indexOf("checkin date");
    const cpValidFromIdx = checkinPlanHeaders.indexOf("checkin valid from");
    const cpValidToIdx = checkinPlanHeaders.indexOf("checkin valid to");

    const courseIdIdx = courseHeaders.indexOf("course id");
    const courseNameEnIdx = courseHeaders.indexOf("course name en");
    const courseNameIdx = courseHeaders.indexOf("course name");
    const courseObjIdx = courseHeaders.indexOf("course objectives");

    const venueIdIdx = venueHeaders.indexOf("facility id") !== -1 ? venueHeaders.indexOf("facility id") : venueHeaders.indexOf("room id");
    const venueTitleIdx = venueHeaders.indexOf("room title") !== -1 ? venueHeaders.indexOf("room title") : venueHeaders.indexOf("room_title");

    const traineeEmailIdx = traineeHeaders.indexOf("trainee email");
    const traineeIdIdx = traineeHeaders.indexOf("trainee id");
    const traineeNameIdx = traineeHeaders.indexOf("trainee full name");

    const sfSecIdIdx = fbSecFormsHeaders.indexOf("section id");
    const sfMappingIdIdx = fbSecFormsHeaders.indexOf("mapping id") !== -1 ? fbSecFormsHeaders.indexOf("mapping id") : fbSecFormsHeaders.indexOf("id");
    const sfFormIdIdx = fbSecFormsHeaders.indexOf("form id");
    const sfFormTitleIdx = fbSecFormsHeaders.indexOf("form title");
    const sfStartIdx = fbSecFormsHeaders.indexOf("response starttime") !== -1 ? fbSecFormsHeaders.indexOf("response starttime") : fbSecFormsHeaders.indexOf("starttime");
    const sfEndIdx = fbSecFormsHeaders.indexOf("response endtime") !== -1 ? fbSecFormsHeaders.indexOf("response endtime") : fbSecFormsHeaders.indexOf("endtime");

    const subMappingIdIdx = getHeaderIndex(fbSubmissionsHeaders, ["mapping id", "mapping_id"]);
    const subTraineeIdx = getHeaderIndex(fbSubmissionsHeaders, ["trainee id", "trainee email", "user email", "user_email", "trainee_id"]);
    const subTimestampIdx = getHeaderIndex(fbSubmissionsHeaders, ["submitted at", "submitted_at", "timestamp", "submitted time", "submission time", "created at"]);

    if (secIdIdx === -1) {
      throw new Error("Missing 'section id' column in Section sheet.");
    }

    // Build course dictionary
    const courses = {};
    if (courseIdIdx !== -1 && courseValues.length > 1) {
      for (let i = 1; i < courseValues.length; i++) {
        const row = courseValues[i];
        const cid = String(row[courseIdIdx] || "").trim();
        if (!cid) continue;
        const name = (courseNameEnIdx !== -1 && row[courseNameEnIdx]) ? String(row[courseNameEnIdx]) :
                     (courseNameIdx !== -1 && row[courseNameIdx]) ? String(row[courseNameIdx]) : cid;
        const objectives = courseObjIdx !== -1 ? String(row[courseObjIdx] || "") : "";
        courses[cid] = { name, objectives };
      }
    }

    // Build room/venue dictionary
    const venues = {};
    if (venueIdIdx !== -1 && venueValues.length > 1) {
      for (let i = 1; i < venueValues.length; i++) {
        const row = venueValues[i];
        const vid = String(row[venueIdIdx] || "").trim();
        if (!vid) continue;
        const title = venueTitleIdx !== -1 ? String(row[venueTitleIdx] || "") : vid;
        venues[vid] = title;
      }
    }

    // Build trainee dictionaries mapping traineeId <-> email <-> name
    const traineeById = {};
    const traineeByEmail = {};
    if (traineeValues.length > 1) {
      for (let i = 1; i < traineeValues.length; i++) {
        const row = traineeValues[i];
        const email = traineeEmailIdx !== -1 ? normalizeEmail(row[traineeEmailIdx]) : "";
        const tid = traineeIdIdx !== -1 ? normalizeEmail(row[traineeIdIdx]) : "";
        const name = traineeNameIdx !== -1 ? String(row[traineeNameIdx] || "").trim() : "";
        if (!email && !tid) continue;

        const profile = {
          traineeId: tid || email,
          email: email || tid,
          name: name || "Học viên"
        };
        if (tid) traineeById[tid] = profile;
        if (email) traineeByEmail[email] = profile;
      }
    }

    // Map section attendee registrations
    const registrations = {}; // sectionId -> Array of { traineeId, registeredAt }
    const regRegisteredAtIdx = regHeaders.indexOf("registered at");
    if (regSectionIdIdx !== -1 && regTraineeIdIdx !== -1 && regValues.length > 1) {
      for (let i = 1; i < regValues.length; i++) {
        const row = regValues[i];
        const sid = String(row[regSectionIdIdx] || "").trim();
        const tid = normalizeEmail(row[regTraineeIdIdx]);
        const registeredAt = regRegisteredAtIdx !== -1 ? String(row[regRegisteredAtIdx] || "").trim() : "";
        if (!sid || !tid) continue;
        if (!registrations[sid]) registrations[sid] = [];
        if (!registrations[sid].some(r => r.traineeId === tid)) {
          registrations[sid].push({ traineeId: tid, registeredAt });
        }
      }
    }

    // Map checkin plan slots per section
    const checkinSlots = {}; // sectionId -> Array of slots
    if (cpSectionIdIdx !== -1 && cpSlotIdIdx !== -1 && checkinPlanValues.length > 1) {
      for (let i = 1; i < checkinPlanValues.length; i++) {
        const row = checkinPlanValues[i];
        const sid = String(row[cpSectionIdIdx] || "").trim();
        const slotId = String(row[cpSlotIdIdx] || "").trim();
        if (!sid || !slotId) continue;
        if (!checkinSlots[sid]) checkinSlots[sid] = [];
        
        const dateStr = cpDateIdx !== -1 ? String(row[cpDateIdx] || "") : "";
        const validFrom = cpValidFromIdx !== -1 ? String(row[cpValidFromIdx] || "") : "";
        const validTo = cpValidToIdx !== -1 ? String(row[cpValidToIdx] || "") : "";
        
        checkinSlots[sid].push({ slotId, dateStr, validFrom, validTo });
      }
      for (const sid in checkinSlots) {
        checkinSlots[sid].sort((a, b) => parseDate(a.dateStr) - parseDate(b.dateStr));
      }
    }

    // Map checkin logs
    const checkinLogs = {}; // sectionId -> traineeId -> slotId -> timestamp
    if (checkinSectionIdIdx !== -1 && checkinTraineeIdIdx !== -1 && checkinSlotIdIdx !== -1 && checkinValues.length > 1) {
      for (let i = 1; i < checkinValues.length; i++) {
        const row = checkinValues[i];
        const sid = String(row[checkinSectionIdIdx] || "").trim();
        const tid = normalizeEmail(row[checkinTraineeIdIdx]);
        const slotId = String(row[checkinSlotIdIdx] || "").trim();
        const timestamp = checkinTimestampIdx !== -1 ? String(row[checkinTimestampIdx] || "") : "";
        if (!sid || !tid || !slotId) continue;
        if (!checkinLogs[sid]) checkinLogs[sid] = {};
        if (!checkinLogs[sid][tid]) checkinLogs[sid][tid] = {};
        checkinLogs[sid][tid][slotId] = timestamp;
      }
    }

    // Map feedback mappings per section
    const feedbackMappings = {}; // sectionId -> Array of mapping objs
    if (sfSecIdIdx !== -1 && sfMappingIdIdx !== -1 && fbSecFormsValues.length > 1) {
      for (let i = 1; i < fbSecFormsValues.length; i++) {
        const row = fbSecFormsValues[i];
        const sid = String(row[sfSecIdIdx] || "").trim();
        const mid = String(row[sfMappingIdIdx] || "").trim();
        const formId = sfFormIdIdx !== -1 ? String(row[sfFormIdIdx] || "") : "";
        const formTitle = sfFormTitleIdx !== -1 ? String(row[sfFormTitleIdx] || "") : "Khảo sát";
        const startTime = sfStartIdx !== -1 ? String(row[sfStartIdx] || "") : "";
        const endTime = sfEndIdx !== -1 ? String(row[sfEndIdx] || "") : "";
        if (!sid || !mid) continue;
        if (!feedbackMappings[sid]) feedbackMappings[sid] = [];
        feedbackMappings[sid].push({ mappingId: mid, formId, formTitle, startTime, endTime });
      }
    }

    // Map feedback submissions
    const feedbackSubmissions = {}; // mappingId -> traineeEmail/Id -> submittedAt
    if (subMappingIdIdx !== -1 && subTraineeIdx !== -1 && fbSubmissionsValues.length > 1) {
      for (let i = 1; i < fbSubmissionsValues.length; i++) {
        const row = fbSubmissionsValues[i];
        const mid = String(row[subMappingIdIdx] || "").trim();
        const ident = normalizeEmail(row[subTraineeIdx]);
        const submittedAt = subTimestampIdx !== -1 ? String(row[subTimestampIdx] || "") : "";
        if (!mid || !ident) continue;
        if (!feedbackSubmissions[mid]) feedbackSubmissions[mid] = {};
        feedbackSubmissions[mid][ident] = submittedAt;
      }
    }

    // Process sections
    const sections = [];
    const now = new Date();

    for (let i = 1; i < secValues.length; i++) {
      const row = secValues[i];
      const sectionId = String(row[secIdIdx] || "").trim();
      if (!sectionId) continue;

      const courseId = secCourseIdIdx !== -1 ? String(row[secCourseIdIdx] || "").trim() : "";
      const courseObj = courses[courseId] || {};
      const courseName = courseObj.name || courseId || "Unknown Course";
      const courseObjectives = courseObj.objectives || "";
      const status = secStatusIdx !== -1 ? String(row[secStatusIdx] || "").trim() : "Unknown";
      const sectionDate = secDateIdx !== -1 ? String(row[secDateIdx] || "").trim() : "";
      const dateStart = secDateStartIdx !== -1 ? String(row[secDateStartIdx] || "").trim() : "";
      const roomIdStr = secRoomIdIdx !== -1 ? String(row[secRoomIdIdx] || "").trim() : "";
      const roomIds = roomIdStr.split(/[\s,;]+/).filter(Boolean);
      const venueNames = roomIds.map(id => venues[id] || id);
      const venue = venueNames.length > 0 ? venueNames.join(", ") : "N/A";

      // Count registered
      const regSet = registrations[sectionId] || [];
      const registeredCount = regSet.length;

      // Checkin plans & logs
      const slots = checkinSlots[sectionId] || [];
      const sectionCheckins = checkinLogs[sectionId] || {};

      // Feedback forms & submissions
      const mappings = feedbackMappings[sectionId] || [];

      // Calculate rates
      let totalCheckedInTrainees = 0;
      let totalFeedbackSubmissions = 0;

      // Detailed Trainees list
      const traineesList = [];
      for (const reg of regSet) {
        const regId = reg.traineeId;
        const registeredAt = reg.registeredAt;
        // Resolve profile by either trainee ID code or email
        const profile = traineeById[regId] || traineeByEmail[regId] || {
          traineeId: regId,
          email: regId,
          name: "Học viên"
        };
        
        // Process checkins: match checkin by registered trainee ID string, profile email, or profile trainee ID
        const traineeCheckins = sectionCheckins[regId] || 
                               (profile.email && sectionCheckins[profile.email]) || 
                               (profile.traineeId && sectionCheckins[profile.traineeId]) || {};
        const checkinStatus = [];
        let checkedSlotsCount = 0;
        
        for (const slot of slots) {
          const checkinTime = traineeCheckins[slot.slotId];
          let checkinState = "upcoming";
          if (checkinTime !== undefined) {
            checkinState = "checked";
            checkedSlotsCount++;
          } else {
            // Check if slot validity has expired
            if (isSlotExpired(slot, now)) {
              checkinState = "absent";
            }
          }
          checkinStatus.push({ slotId: slot.slotId, status: checkinState, timestamp: checkinTime || null });
        }
        
        if (checkedSlotsCount > 0) {
          totalCheckedInTrainees++;
        }

        // Process feedbacks: match feedback submission by either traineeId or email
        const feedbackStatus = [];
        let submittedFormsCount = 0;
        
        for (const mapping of mappings) {
          const submissionsForMapping = feedbackSubmissions[mapping.mappingId] || {};
          const submittedTime = submissionsForMapping[regId] || 
                                (profile.email && submissionsForMapping[profile.email]) || 
                                (profile.traineeId && submissionsForMapping[profile.traineeId]);
          let feedbackState = "upcoming";
          if (submittedTime !== undefined) {
            feedbackState = "submitted";
            submittedFormsCount++;
          } else {
            // Check if mapping deadline has expired
            const expTime = parseDate(mapping.endTime || "");
            if (expTime > 0 && expTime < now.getTime()) {
              feedbackState = "absent";
            }
          }
          feedbackStatus.push({ mappingId: mapping.mappingId, status: feedbackState, timestamp: submittedTime || null });
        }

        if (submittedFormsCount > 0) {
          totalFeedbackSubmissions++;
        }

        traineesList.push({
          traineeId: profile.traineeId,
          email: profile.email,
          name: profile.name,
          registeredAt: registeredAt || "N/A",
          checkinStatus,
          checkinCompletionRate: slots.length > 0 ? (checkedSlotsCount / slots.length) : 0,
          feedbackStatus,
          feedbackCompletionRate: mappings.length > 0 ? (submittedFormsCount / mappings.length) : 0
        });
      }

      // If no registrations but check-ins happened
      let uniqueCheckinsCount = 0;
      for (const tid in sectionCheckins) {
        if (Object.keys(sectionCheckins[tid]).length > 0) uniqueCheckinsCount++;
      }
      const actualCheckinCount = registeredCount > 0 ? totalCheckedInTrainees : uniqueCheckinsCount;

      // Feedback count
      let actualFeedbackCount = 0;
      const uniqueFeedbackTrainees = new Set();
      for (const mapping of mappings) {
        const subs = feedbackSubmissions[mapping.mappingId] || {};
        for (const email in subs) {
          uniqueFeedbackTrainees.add(email);
        }
      }
      actualFeedbackCount = registeredCount > 0 ? totalFeedbackSubmissions : uniqueFeedbackTrainees.size;

      sections.push({
        sectionId,
        courseId,
        courseName,
        courseObjectives,
        status,
        sectionDate,
        dateStart,
        venue,
        registeredCount,
        checkinCount: actualCheckinCount,
        checkinRate: registeredCount > 0 ? (actualCheckinCount / registeredCount) : 0,
        feedbackCount: actualFeedbackCount,
        feedbackRate: registeredCount > 0 ? (actualFeedbackCount / registeredCount) : 0,
        slots,
        mappings,
        trainees: traineesList
      });
    }

    // Sort sections: dateStart ascending, sectionId ascending
    sections.sort((a, b) => {
      const dateA = parseDate(a.dateStart || a.sectionDate || "");
      const dateB = parseDate(b.dateStart || b.sectionDate || "");
      if (dateA !== dateB) return dateA - dateB;
      return a.sectionId.localeCompare(b.sectionId);
    });

    return jsonResponse({
      success: true,
      data: sections
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}

function isSlotExpired(slot, now) {
  // 1. Try to parse validTo as a full datetime
  let expTime = parseDate(slot.validTo);
  if (expTime > 0) {
    return expTime < now.getTime();
  }

  // 2. If validTo is just a time (e.g. "hh:mm:ss" or "hh:mm"), combine it with dateStr
  if (slot.validTo && slot.dateStr) {
    const timeStr = String(slot.validTo).trim();
    if (timeStr.includes(":")) {
      const dateTimeStr = `${slot.dateStr.trim()} ${timeStr}`;
      expTime = parseDate(dateTimeStr);
      if (expTime > 0) {
        return expTime < now.getTime();
      }
    }
  }

  // 3. Fallback: Parse dateStr alone (if it's yesterday or earlier, it's expired)
  const dateStrParsed = parseDate(slot.dateStr);
  if (dateStrParsed > 0) {
    // If the date is strictly before today (00:00:00 of today), it is expired.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const slotDay = new Date(dateStrParsed);
    const slotDayMidnight = new Date(slotDay.getFullYear(), slotDay.getMonth(), slotDay.getDate()).getTime();
    return slotDayMidnight < today;
  }

  return false;
}

function parseDate(dateStr) {
  if (!dateStr) return 0;
  
  // Try parsing DD/MM/YYYY hh:mm:ss or DD/MM/YYYY
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const d = parseInt(match[1], 10);
    const m = parseInt(match[2], 10) - 1;
    const y = parseInt(match[3], 10);
    
    // Check if time is included
    const timeMatch = str.match(/(\d{1,2}):(\d{2}):?(\d{2})?/);
    if (timeMatch) {
      const hh = parseInt(timeMatch[1], 10);
      const mm = parseInt(timeMatch[2], 10);
      const ss = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      return new Date(y, m, d, hh, mm, ss).getTime();
    }
    return new Date(y, m, d).getTime();
  }

  // Try direct parse
  let ms = Date.parse(str);
  if (Number.isFinite(ms)) return ms;

  return 0;
}

async function fetchTableAsMatrix(env, tableKey, spreadsheetId) {
  const source = getTableSource(env, tableKey);
  if (source === "psql") {
    const psqlName = getTablePsqlName(env, tableKey);
    const result = await queryPostgres(env, "SELECT * FROM " + quoteIdentifierPath(psqlName), []);
    if (result.error) throw new Error(result.error);
    const rows = result.rows || [];
    if (rows.length === 0) return { values: [] };
    const headers = Object.keys(rows[0]);
    const values = [headers];
    for (const row of rows) {
      values.push(headers.map(h => {
        const val = row[h];
        if (val instanceof Date) {
          const d = new Date(val);
          d.setUTCHours(d.getUTCHours() - 7);
          return d;
        }
        return val;
      }));
    }
    return { values };
  } else {
    const sheetName = getTableSheetName(env, tableKey);
    if (!sheetName) return { values: [] };
    return getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:ZZ`).catch(() => ({ values: [] }));
  }
}
