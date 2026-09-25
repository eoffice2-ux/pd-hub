import { appendSheetValues, batchUpdateSheetValues, getCoreSpreadsheetId, getSheetValues, makeCellRange, quoteSheetName } from "./google-sheets.js";
import { normalizeEmail } from "./security.js";
import { getTableSheetName } from "./data-source.js";

export const TBL_TRAINEE = "pdc_trainee general profile";

function tableSheet(env, tableKey, fallback) {
  return getTableSheetName(env, tableKey) || fallback;
}


const PROFILE_FIELD_MAP = {
  fullName: "trainee full name",
  phone: "trainee phone",
  gender: "trainee gender",
  organization: "trainee organization new",
  organizationId: "trainee organization id",
  position: "trainee position"
};

export function getUserType(email) {
  const cleanEmail = normalizeEmail(email);
  if (cleanEmail.endsWith("@eiu.edu.vn")) {
    const studentRegex = /\.(bbs|sns|cit|set|mba)\d+@eiu\.edu\.vn$/;
    if (studentRegex.test(cleanEmail) || cleanEmail === "eoffice2@eiu.edu.vn") return "Student";
    return "Staff";
  }
  return "Industry";
}

export async function readTraineeTable(env, options = {}) {
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");
  const result = await getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE))}!A:ZZ`, options);
  const values = Array.isArray(result.values) ? result.values : [];
  if (values.length < 1) throw new Error(`Sheet '${TBL_TRAINEE}' has no header row.`);
  const headers = values[0].map(normalizeHeader);
  return { spreadsheetId, values, headers };
}

export function findTraineeRow(values, headers, email) {
  const cleanEmail = normalizeEmail(email);
  const emailIdx = headers.indexOf("trainee email");
  const idIdx = headers.indexOf("trainee id");
  const rowArrayIndex = values.findIndex((row, index) => {
    if (index === 0) return false;
    const rowEmail = emailIdx !== -1 ? normalizeEmail(row[emailIdx]) : "";
    const rowId = idIdx !== -1 ? normalizeEmail(row[idIdx]) : "";
    return rowEmail === cleanEmail || rowId === cleanEmail;
  });
  if (rowArrayIndex === -1) return null;
  return { rowArrayIndex, sheetRowNumber: rowArrayIndex + 1, row: values[rowArrayIndex] || [] };
}

export function buildAccessType(row, headers) {
  if (!row) return { hasPin: false, exists: false };
  const pinIdx = headers.indexOf("trainee pin");
  const pinVal = pinIdx !== -1 ? String(row[pinIdx] ?? "").trim() : "";
  return { hasPin: pinVal !== "", exists: true };
}

export function buildTraineeProfile(row, headers, email) {
  const cleanEmail = normalizeEmail(email);
  if (!row) return { isNew: true, email: cleanEmail, hasPin: false };

  const fullName = getCell(row, headers, "trainee full name");
  const pin = getCell(row, headers, "trainee pin");

  if (!fullName || String(fullName).trim() === "") {
    return {
      isNew: true,
      email: cleanEmail,
      hasPin: String(pin || "").trim() !== ""
    };
  }

  return {
    isNew: false,
    email: cleanEmail,
    fullName,
    phone: getCell(row, headers, "trainee phone"),
    gender: getCell(row, headers, "trainee gender"),
    organization: getCell(row, headers, "trainee organization new"),
    organizationId: getCell(row, headers, "trainee organization id"),
    position: getCell(row, headers, "trainee position"),
    hasPin: String(pin || "").trim() !== ""
  };
}

export async function updateTraineeProfileInSheet(env, email, data, dryRun = true) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new Error("Missing trainee email.");
  const { spreadsheetId, values, headers } = await readTraineeTable(env, { bypassCache: true });
  const found = findTraineeRow(values, headers, cleanEmail);
  const traineeType = getUserType(cleanEmail);
  const now = formatVietnamDateTime(new Date());

  const updateMap = {
    "trainee id": cleanEmail,
    "trainee email": cleanEmail,
    "trainee type": traineeType,
    "user updated datetime": now
  };

  for (const [inputKey, headerName] of Object.entries(PROFILE_FIELD_MAP)) {
    if (data[inputKey] !== undefined) updateMap[headerName] = data[inputKey] ?? "";
  }

  const updatedFields = [];
  let googleResult = null;

  if (found) {
    const updates = [];
    for (const [headerName, value] of Object.entries(updateMap)) {
      const colIdx = headers.indexOf(headerName);
      if (colIdx === -1) continue;
      updates.push({ range: makeCellRange(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE), found.sheetRowNumber, colIdx + 1), values: [[value]] });
      updatedFields.push(headerName);
    }
    if (updates.length === 0) throw new Error("No matching editable trainee profile columns found.");
    if (!dryRun) googleResult = await batchUpdateSheetValues(env, spreadsheetId, updates);
    return {
      mode: "update",
      row: found.sheetRowNumber,
      updatedFields: unique(updatedFields),
      updatedCellCount: updates.length,
      googleUpdatedCells: googleResult?.totalUpdatedCells ?? 0
    };
  }

  // Create new trainee row if not found, matching updateTraineeProfile in GAS.
  const newRow = new Array(headers.length).fill("");
  for (const [headerName, value] of Object.entries(updateMap)) {
    const colIdx = headers.indexOf(headerName);
    if (colIdx === -1) continue;
    newRow[colIdx] = value;
    updatedFields.push(headerName);
  }
  if (!dryRun) googleResult = await appendSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE))}!A:ZZ`, [newRow]);
  return {
    mode: "append",
    row: null,
    updatedFields: unique(updatedFields),
    updatedCellCount: updatedFields.length,
    googleUpdatedCells: googleResult?.updates?.updatedCells ?? 0
  };
}

export async function setTraineePinInSheet(env, email, pin, dryRun = true) {
  const cleanEmail = normalizeEmail(email);
  if (!/^\d{4}$/.test(String(pin || ""))) throw new Error("PIN must be 4 digits.");
  const { spreadsheetId, values, headers } = await readTraineeTable(env, { bypassCache: true });
  const pinIdx = headers.indexOf("trainee pin");
  const emailIdx = headers.indexOf("trainee email");
  const idIdx = headers.indexOf("trainee id");
  if (pinIdx === -1) throw new Error("Missing 'trainee pin' column in trainee profile sheet.");
  const found = findTraineeRow(values, headers, cleanEmail);
  let googleResult = null;

  if (found) {
    const updates = [{ range: makeCellRange(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE), found.sheetRowNumber, pinIdx + 1), values: [["'" + String(pin)]] }];
    const updatedFields = ["trainee pin"];
    if (idIdx !== -1) {
      updates.push({ range: makeCellRange(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE), found.sheetRowNumber, idIdx + 1), values: [[cleanEmail]] });
      updatedFields.push("trainee id");
    }
    if (emailIdx !== -1) {
      updates.push({ range: makeCellRange(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE), found.sheetRowNumber, emailIdx + 1), values: [[cleanEmail]] });
      updatedFields.push("trainee email");
    }
    if (!dryRun) googleResult = await batchUpdateSheetValues(env, spreadsheetId, updates);
    return { mode: "update", row: found.sheetRowNumber, updatedFields: unique(updatedFields), updatedCellCount: updates.length, googleUpdatedCells: googleResult?.totalUpdatedCells ?? 0 };
  }

  const newRow = new Array(headers.length).fill("");
  if (idIdx !== -1) newRow[idIdx] = cleanEmail;
  if (emailIdx !== -1) newRow[emailIdx] = cleanEmail;
  newRow[pinIdx] = "'" + String(pin);
  if (!dryRun) googleResult = await appendSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "TRAINEE_PROFILE", TBL_TRAINEE))}!A:ZZ`, [newRow]);
  return { mode: "append", row: null, updatedFields: ["trainee id", "trainee email", "trainee pin"].filter(h => headers.includes(h)), updatedCellCount: 3, googleUpdatedCells: googleResult?.updates?.updatedCells ?? 0 };
}

export function getPinValue(row, headers) {
  return getCell(row, headers, "trainee pin");
}

function getCell(row, headers, headerName) {
  const idx = headers.indexOf(headerName);
  return idx !== -1 ? (row[idx] ?? "") : "";
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().trim();
}

function unique(values) {
  return [...new Set(values)];
}

function formatVietnamDateTime(date) {
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


function getHeaderValue(row, headers, possibleHeaders) {
  for (const header of possibleHeaders) {
    const idx = headers.indexOf(header);
    if (idx !== -1 && row[idx] !== undefined && row[idx] !== null && String(row[idx]).trim() !== "") {
      return row[idx];
    }
  }
  return "";
}

function parseVietnamDateParts(value) {
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

function parseTimeParts(value, fallbackEnd = false) {
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

function vietnamLocalToUtcMs(parts) {
  // Vietnam is UTC+7 and does not currently use DST.
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 7, parts.minute, parts.second || 0);
}

function buildCheckinTimeWindow(slotRow, headers) {
  const typeValue = getHeaderValue(slotRow, headers, ["checkin type", "check-in type", "type"]);
  const typeLower = safeLower(typeValue);
  const isFlexible = typeLower.includes("flexible");
  const dateValue = getHeaderValue(slotRow, headers, ["checkin date", "check-in date", "date", "dateid"]);
  const fromValue = getHeaderValue(slotRow, headers, ["checkin valid from", "valid from", "from", "start time", "checkin start time"]);
  const toValue = getHeaderValue(slotRow, headers, ["checkin valid to", "valid to", "to", "end time", "checkin end time"]);

  // Original frontend behavior:
  // - Scheduled Check-In: same date + within valid from/to.
  // - Flexible Check-In: same date, click allowed all day.
  // Backend hardening follows that UI behavior instead of treating all types as scheduled.
  if (!dateValue) {
    return { enforced: false, reason: "Missing check-in date; time window not enforced for this slot.", typeValue: String(typeValue || "") };
  }

  const dateParts = parseVietnamDateParts(dateValue);
  if (!dateParts) {
    return { enforced: true, valid: false, reason: "Invalid check-in date configuration.", typeValue: String(typeValue || "") };
  }

  let fromParts;
  let toParts;
  if (isFlexible) {
    fromParts = { hour: 0, minute: 0, second: 0 };
    toParts = { hour: 23, minute: 59, second: 59 };
  } else {
    if (!fromValue || !toValue) {
      return { enforced: false, reason: "Missing scheduled check-in from/to; time window not enforced for this slot.", typeValue: String(typeValue || "") };
    }
    fromParts = parseTimeParts(fromValue, false);
    toParts = parseTimeParts(toValue, true);
    if (!fromParts || !toParts) {
      return { enforced: true, valid: false, reason: "Invalid scheduled check-in time window configuration.", typeValue: String(typeValue || "") };
    }
  }

  let startMs = vietnamLocalToUtcMs({ ...dateParts, ...fromParts });
  let endMs = vietnamLocalToUtcMs({ ...dateParts, ...toParts });
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;

  const nowMs = Date.now();
  return {
    enforced: true,
    valid: true,
    isOpen: nowMs >= startMs && nowMs <= endMs,
    now: formatVietnamDateTime(new Date(nowMs)),
    validFrom: formatVietnamDateTime(new Date(startMs)),
    validTo: formatVietnamDateTime(new Date(endMs)),
    dateValue: String(dateValue),
    fromValue: isFlexible ? "00:00:00" : String(fromValue),
    toValue: isFlexible ? "23:59:59" : String(toValue),
    typeValue: String(typeValue || ""),
    rule: isFlexible ? "Flexible date-only check-in window" : "Scheduled date-and-time check-in window"
  };
}

function calculateSlotEndTimestamp(dateValue, toValue) {
  if (!dateValue && !toValue) return 0;
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

export const TBL_SECTION = "pdc_section management";
export const TBL_ATTENDEE = "pdc_section attendee management";
export const TBL_COURSE = "pdc_course master list";
export const TBL_VENUE = "pdc-room lab management";

const SECTION_ALLOW_VIEW = ["registration open", "registration closed", "in progress"];
// Business rule: allow late registration for sections already in progress
// if today is still within date start/end registration window.
const SECTION_ALLOW_REGISTRATION = ["registration open", "in progress"];

export async function getTraineeSectionsFromSheet(env, traineeEmail, options = {}) {
  const cleanEmail = normalizeEmail(traineeEmail);
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [sectionResult, attendeeResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION", TBL_SECTION))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, options)
  ]);

  const sectionValues = Array.isArray(sectionResult.values) ? sectionResult.values : [];
  const attendeeValues = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  if (sectionValues.length < 1) throw new Error(`Sheet '${TBL_SECTION}' has no header row.`);
  if (attendeeValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);

  const sHeaders = sectionValues[0].map(normalizeHeader);
  const aHeaders = attendeeValues[0].map(normalizeHeader);
  const sRows = sectionValues.slice(1);
  const aRows = attendeeValues.slice(1);

  const aTraineeIdx = aHeaders.indexOf("trainee id");
  const aSectionIdx = aHeaders.indexOf("section id");
  const registeredIds = new Set();
  if (aTraineeIdx !== -1 && aSectionIdx !== -1) {
    for (const row of aRows) {
      if (normalizeEmail(row[aTraineeIdx]) === cleanEmail) registeredIds.add(String(row[aSectionIdx] || "").trim());
    }
  }

  const userType = getUserType(cleanEmail);
  const indexes = {
    sectionType: sHeaders.indexOf("section type"),
    status: sHeaders.indexOf("section status"),
    id: sHeaders.indexOf("section id"),
    name: sHeaders.indexOf("section name en"),
    date: sHeaders.indexOf("section date"),
    venue: sHeaders.indexOf("section venue"),
    startReg: sHeaders.indexOf("date start registration"),
    endReg: sHeaders.indexOf("date end registration")
  };
  if (indexes.id === -1 || indexes.status === -1) throw new Error("Missing required columns in section management sheet.");

  const now = new Date();
  const data = [];

  for (const row of sRows) {
    const sectionId = String(row[indexes.id] || "").trim();
    if (!sectionId) continue;

    const rawStatus = String(row[indexes.status] || "").toLowerCase().trim();
    if (!SECTION_ALLOW_VIEW.includes(rawStatus)) continue;

    const sectionType = String(row[indexes.sectionType] || "").toLowerCase().trim();
    let typeMatch = false;
    if (userType === "Industry") typeMatch = sectionType === "industry";
    else if (userType === "Staff") typeMatch = sectionType === "eiu staff";
    else if (userType === "Student") typeMatch = sectionType === "student";
    if (!typeMatch) continue;

    const startReg = parseSheetDate(indexes.startReg !== -1 ? row[indexes.startReg] : "", new Date("2000-01-01"), false);
    const endReg = parseSheetDate(indexes.endReg !== -1 ? row[indexes.endReg] : "", new Date("2099-12-31"), true);
    const isRegistered = registeredIds.has(sectionId);

    let displayStatus = "";
    if (isRegistered) displayStatus = "Registered";
    else if (now < startReg) displayStatus = "Not Open for registration yet";
    else if (now > endReg) displayStatus = "Missed";
    else if (SECTION_ALLOW_REGISTRATION.includes(rawStatus)) displayStatus = "Open for registration";
    else displayStatus = "Registration Closed";

    data.push({
      id: sectionId,
      name: indexes.name !== -1 ? String(row[indexes.name] || "") : sectionId,
      date: indexes.date !== -1 ? String(row[indexes.date] || "N/A").replace(/\n/g, "<br>") : "N/A",
      venue: indexes.venue !== -1 ? String(row[indexes.venue] || "") : "",
      status: displayStatus,
      isRegistered
    });
  }

  return { userType, registeredCount: registeredIds.size, data };
}

export async function getTraineeSectionDetailsFromSheet(env, sectionId, options = {}) {
  const safeSectionId = String(sectionId || "").trim();
  if (!safeSectionId) throw new Error("Missing sectionId.");
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [sectionResult, courseResult, venueResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION", TBL_SECTION))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "COURSE_MASTER", TBL_COURSE))}!A:ZZ`, { ttl: 30, bypassCache: options?.bypassCache }).catch(() => ({ values: [] })),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "VENUE", TBL_VENUE))}!A:ZZ`, { ttl: 30, bypassCache: options?.bypassCache }).catch(() => ({ values: [] }))
  ]);

  const sValues = Array.isArray(sectionResult.values) ? sectionResult.values : [];
  if (sValues.length < 1) throw new Error(`Sheet '${TBL_SECTION}' has no header row.`);
  const sHeaders = sValues[0].map(normalizeHeader);
  const sRows = sValues.slice(1);
  const sIdIdx = sHeaders.indexOf("section id");
  if (sIdIdx === -1) throw new Error("Missing 'section id' column in section management sheet.");
  const sectionRow = sRows.find(row => String(row[sIdIdx] || "").trim() === safeSectionId);
  if (!sectionRow) return { error: "Section not found in the database." };

  const details = {
    sectionId: safeSectionId,
    sectionNumber: getByHeader(sectionRow, sHeaders, "section number") || safeSectionId,
    nameEn: getByHeader(sectionRow, sHeaders, "section name en") || "N/A",
    nameVn: getByHeader(sectionRow, sHeaders, "section name vn") || "N/A",
    date: getByHeader(sectionRow, sHeaders, "section date") || "N/A",
    traineeType: getByHeader(sectionRow, sHeaders, "section trainee type") || "N/A",
    sectionType: getByHeader(sectionRow, sHeaders, "section type") || "N/A",
    venue: getByHeader(sectionRow, sHeaders, "section venue") || "N/A",
    status: getByHeader(sectionRow, sHeaders, "section status") || "N/A",
    bdIncharge: getByHeader(sectionRow, sHeaders, "bd incharge id") || "N/A",
    courseId: getByHeader(sectionRow, sHeaders, "course id") || "",
    roomId: getByHeader(sectionRow, sHeaders, "section room id") || ""
  };

  details.courseName = lookupCourseName(courseResult.values || [], details.courseId) || details.courseId || details.nameEn;
  details.roomTitle = lookupRoomTitle(venueResult.values || [], details.roomId) || details.roomId || "N/A";
  return details;
}



export async function registerTraineeForSectionInSheet(env, email, sectionId, dryRun = true) {
  const cleanEmail = normalizeEmail(email);
  const safeSectionId = String(sectionId || "").trim();
  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeSectionId) throw new Error("Missing sectionId.");

  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [sectionResult, attendeeResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION", TBL_SECTION))}!A:ZZ`),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, { bypassCache: true })
  ]);

  const sectionValues = Array.isArray(sectionResult.values) ? sectionResult.values : [];
  const attendeeValues = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  if (sectionValues.length < 1) throw new Error(`Sheet '${TBL_SECTION}' has no header row.`);
  if (attendeeValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);

  const sHeaders = sectionValues[0].map(normalizeHeader);
  const aHeaders = attendeeValues[0].map(normalizeHeader);
  const sRows = sectionValues.slice(1);
  const aRows = attendeeValues.slice(1);

  const sIdIdx = sHeaders.indexOf("section id");
  const sStatusIdx = sHeaders.indexOf("section status");
  const sTypeIdx = sHeaders.indexOf("section type");
  const sNameIdx = sHeaders.indexOf("section name en");
  const sCourseIdx = sHeaders.indexOf("course id");
  const sStartIdx = sHeaders.indexOf("date start registration");
  const sEndIdx = sHeaders.indexOf("date end registration");
  if (sIdIdx === -1) throw new Error("Missing 'section id' column in section management sheet.");

  const sectionRow = sRows.find(row => String(row[sIdIdx] || "").trim() === safeSectionId);
  if (!sectionRow) {
    return { status: "Error", message: "Section not found", sectionId: safeSectionId, registered: false, googleUpdatedCells: 0 };
  }

  const aTraineeIdx = aHeaders.indexOf("trainee id");
  const aSectionIdx = aHeaders.indexOf("section id");
  if (aTraineeIdx === -1 || aSectionIdx === -1) throw new Error("Missing required columns in attendee management sheet.");

  const isDup = aRows.some(row =>
    String(row[aSectionIdx] || "").trim() === safeSectionId &&
    normalizeEmail(row[aTraineeIdx]) === cleanEmail
  );
  if (isDup) {
    return { status: "Already Registered", message: "Already Registered", sectionId: safeSectionId, registered: true, duplicate: true, googleUpdatedCells: 0 };
  }

  // Profile completeness check — all mandatory fields must be filled.
  const REQUIRED_GSHEET_FIELDS = ["trainee full name", "trainee gender", "trainee phone", "trainee organization new", "trainee position"];
  const traineeTableResult = await readTraineeTable(env);
  const traineeRow = findTraineeRow(traineeTableResult.values, traineeTableResult.headers, cleanEmail);
  const isProfileComplete = traineeRow && REQUIRED_GSHEET_FIELDS.every(f => {
    const idx = traineeTableResult.headers.indexOf(f);
    return idx !== -1 && String(traineeRow.row[idx] || "").trim() !== "";
  });
  if (!isProfileComplete) {
    return {
      status: "Forbidden",
      message: "Please complete your profile before registering for a course. All mandatory fields (Full Name, Gender, Phone, Organization, Position) must be filled.",
      sectionId: safeSectionId,
      registered: false,
      googleUpdatedCells: 0
    };
  }

  const userType = getUserType(cleanEmail);
  const sectionType = sTypeIdx !== -1 ? String(sectionRow[sTypeIdx] || "").toLowerCase().trim() : "";
  let typeMatch = false;
  if (userType === "Industry") typeMatch = sectionType === "industry";
  else if (userType === "Staff") typeMatch = sectionType === "eiu staff";
  else if (userType === "Student") typeMatch = sectionType === "student";
  if (!typeMatch) {
    return { status: "Forbidden", message: `This section is not available for user type ${userType}.`, sectionId: safeSectionId, registered: false, googleUpdatedCells: 0 };
  }

  const rawStatus = sStatusIdx !== -1 ? String(sectionRow[sStatusIdx] || "").toLowerCase().trim() : "";
  const startReg = parseSheetDate(sStartIdx !== -1 ? sectionRow[sStartIdx] : "", new Date("2000-01-01"), false);
  const endReg = parseSheetDate(sEndIdx !== -1 ? sectionRow[sEndIdx] : "", new Date("2099-12-31"), true);
  const now = new Date();
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

  const newRow = new Array(aHeaders.length).fill("");
  const mapping = {
    "section attendee id": `${safeSectionId}-${cleanEmail}`,
    "section id": safeSectionId,
    "section name": sNameIdx !== -1 ? String(sectionRow[sNameIdx] || "") : "",
    "course id": sCourseIdx !== -1 ? String(sectionRow[sCourseIdx] || "") : "",
    "trainee id": cleanEmail,
    "registered at": formatVietnamDateTime(new Date())
  };

  const updatedFields = [];
  for (const [header, value] of Object.entries(mapping)) {
    const colIdx = aHeaders.indexOf(header);
    if (colIdx !== -1) {
      newRow[colIdx] = value;
      updatedFields.push(header);
    }
  }

  if (!updatedFields.includes("section id") || !updatedFields.includes("trainee id")) {
    throw new Error("Attendee sheet is missing required output columns for registration.");
  }

  let googleResult = null;
  if (!dryRun) googleResult = await appendSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, [newRow]);

  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No registration row was appended." : "Success",
    sectionId: safeSectionId,
    traineeEmail: cleanEmail,
    registered: !dryRun,
    dryRun,
    updatedFields: unique(updatedFields),
    updatedCellCount: newRow.length,
    googleUpdatedCells: googleResult?.updates?.updatedCells ?? 0,
    section: sectionRow
  };
}


export async function getTraineeActiveSectionsFromSheet(env, traineeEmail, options = {}) {
  const cleanEmail = normalizeEmail(traineeEmail);
  if (!cleanEmail) throw new Error("Missing trainee email.");

  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [attendeeResult, sectionResult, courseResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION", TBL_SECTION))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "COURSE_MASTER", TBL_COURSE))}!A:ZZ`, { ttl: 30, bypassCache: options?.bypassCache }).catch(() => ({ values: [] }))
  ]);

  const attendeeValues = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  const sectionValues = Array.isArray(sectionResult.values) ? sectionResult.values : [];
  const courseValues = Array.isArray(courseResult.values) ? courseResult.values : [];

  if (attendeeValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);
  if (sectionValues.length < 1) throw new Error(`Sheet '${TBL_SECTION}' has no header row.`);

  const aHeaders = attendeeValues[0].map(normalizeHeader);
  const sHeaders = sectionValues[0].map(normalizeHeader);
  const cHeaders = courseValues.length > 0 ? courseValues[0].map(normalizeHeader) : [];
  const aRows = attendeeValues.slice(1);
  const sRows = sectionValues.slice(1);
  const cRows = courseValues.slice(1);

  const aTraineeIdx = aHeaders.indexOf("trainee id");
  const aSectionIdx = aHeaders.indexOf("section id");
  if (aTraineeIdx === -1 || aSectionIdx === -1) {
    throw new Error("Missing columns in attendee management sheet: trainee id / section id.");
  }

  const registeredIds = new Set();
  for (const row of aRows) {
    if (normalizeEmail(row[aTraineeIdx]) === cleanEmail) {
      const sectionId = String(row[aSectionIdx] || "").trim();
      if (sectionId) registeredIds.add(sectionId);
    }
  }

  if (registeredIds.size === 0) {
    return { registeredCount: 0, data: [] };
  }

  const courseDictionary = {};
  if (cHeaders.length > 0) {
    const cIdIdx = cHeaders.indexOf("course id");
    const cNameEnIdx = cHeaders.indexOf("course name en");
    const cNameIdx = cHeaders.indexOf("course name");
    if (cIdIdx !== -1) {
      for (const row of cRows) {
        const courseId = String(row[cIdIdx] || "").trim();
        if (!courseId) continue;
        courseDictionary[courseId] =
          (cNameEnIdx !== -1 && row[cNameEnIdx]) ? String(row[cNameEnIdx]) :
          (cNameIdx !== -1 && row[cNameIdx]) ? String(row[cNameIdx]) :
          courseId;
      }
    }
  }

  const sSecIdx = sHeaders.indexOf("section id");
  const sStatusIdx = sHeaders.indexOf("section status");
  const sCourseIdx = sHeaders.indexOf("course id");
  const sDateIdx = sHeaders.indexOf("section date");
  const sNameIdx = sHeaders.indexOf("section name en");
  if (sSecIdx === -1 || sStatusIdx === -1) {
    throw new Error("Missing columns in section management sheet: section id / section status.");
  }

  const allowedStatuses = new Set(["registration open", "registration closed", "in progress", "post training evaluation"]);
  const activeSections = [];

  for (const row of sRows) {
    const sectionId = String(row[sSecIdx] || "").trim();
    if (!sectionId || !registeredIds.has(sectionId)) continue;

    const rawStatus = String(row[sStatusIdx] || "").toLowerCase().trim();
    if (!allowedStatuses.has(rawStatus)) continue;

    const courseId = sCourseIdx !== -1 ? String(row[sCourseIdx] || "").trim() : "";
    const sectionName = sNameIdx !== -1 ? String(row[sNameIdx] || "").trim() : "";
    const courseName = sectionName || courseDictionary[courseId] || courseId || sectionId;
    const date = sDateIdx !== -1 ? String(row[sDateIdx] || "N/A").replace(/\n/g, "<br>") : "N/A";

    activeSections.push({
      sectionId,
      courseName,
      status: row[sStatusIdx] ? String(row[sStatusIdx]).trim() : "Unknown",
      date
    });
  }

  return { registeredCount: registeredIds.size, data: activeSections };
}


export const TBL_CHECKIN_PLAN = "pdc_section checkin management";
export const TBL_CHECKIN_LOG = "pdc_section checkin log";

export async function getTraineeCheckinDataFromSheet(env, email, sectionId, options = {}) {
  const cleanEmail = normalizeEmail(email);
  const safeSectionId = String(sectionId || "").trim();
  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeSectionId) throw new Error("Missing sectionId.");

  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [attendeeResult, planResult, logResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_PLAN", TBL_CHECKIN_PLAN))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_LOG", TBL_CHECKIN_LOG))}!A:ZZ`, options)
  ]);

  const attendeeValues = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  const planValues = Array.isArray(planResult.values) ? planResult.values : [];
  const logValues = Array.isArray(logResult.values) ? logResult.values : [];

  if (attendeeValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);
  if (planValues.length < 1) throw new Error(`Sheet '${TBL_CHECKIN_PLAN}' has no header row.`);
  if (logValues.length < 1) throw new Error(`Sheet '${TBL_CHECKIN_LOG}' has no header row.`);

  const aHeaders = attendeeValues[0].map(normalizeHeader);
  const pHeaders = planValues[0].map(normalizeHeader);
  const lHeaders = logValues[0].map(normalizeHeader);
  const aRows = attendeeValues.slice(1);
  const pRows = planValues.slice(1);
  const lRows = logValues.slice(1);

  const aTraineeIdx = aHeaders.indexOf("trainee id");
  const aSectionIdx = aHeaders.indexOf("section id");
  if (aTraineeIdx === -1 || aSectionIdx === -1) {
    throw new Error("Missing columns in attendee management sheet: trainee id / section id.");
  }

  const isRegistered = aRows.some(row =>
    normalizeEmail(row[aTraineeIdx]) === cleanEmail &&
    String(row[aSectionIdx] || "").trim() === safeSectionId
  );
  if (!isRegistered) {
    return {
      allowed: false,
      sectionId: safeSectionId,
      plans: [],
      logs: [],
      planCount: 0,
      logCount: 0,
      message: "Trainee is not registered for this section."
    };
  }

  const pSectionIdx = pHeaders.indexOf("section id");
  if (pSectionIdx === -1) throw new Error(`Missing 'section id' column in '${TBL_CHECKIN_PLAN}'.`);

  const lSectionIdx = lHeaders.indexOf("section id");
  const lTraineeIdx = lHeaders.indexOf("trainee id");
  if (lSectionIdx === -1) throw new Error(`Missing 'section id' column in '${TBL_CHECKIN_LOG}'.`);

  const plans = pRows
    .filter(row => String(row[pSectionIdx] || "").trim() === safeSectionId)
    .map(row => rowToObject(row, pHeaders));

  // Privacy-preserving: return only the authenticated trainee's check-in logs.
  // This is enough for the current UI to know which slots are already checked.
  const logs = lRows
    .filter(row => String(row[lSectionIdx] || "").trim() === safeSectionId)
    .filter(row => lTraineeIdx === -1 || normalizeEmail(row[lTraineeIdx]) === cleanEmail)
    .map(row => rowToObject(row, lHeaders));

  return {
    allowed: true,
    sectionId: safeSectionId,
    plans,
    logs,
    planCount: plans.length,
    logCount: logs.length
  };
}


export async function submitTraineeCheckinToSheet(env, email, sectionId, slotId, inputCode, dryRun = true) {
  const cleanEmail = normalizeEmail(email);
  const safeSectionId = String(sectionId || "").trim();
  const safeSlotId = String(slotId || "").trim();
  const cleanInputCode = String(inputCode || "").toLowerCase().trim();

  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeSectionId) throw new Error("Missing sectionId.");
  if (!safeSlotId) throw new Error("Missing slotId.");
  if (!cleanInputCode) throw new Error("Missing check-in code.");

  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [attendeeResult, planResult, logResult] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_PLAN", TBL_CHECKIN_PLAN))}!A:ZZ`),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_LOG", TBL_CHECKIN_LOG))}!A:ZZ`, { bypassCache: true })
  ]);

  const attendeeValues = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  const planValues = Array.isArray(planResult.values) ? planResult.values : [];
  const logValues = Array.isArray(logResult.values) ? logResult.values : [];

  if (attendeeValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);
  if (planValues.length < 1) throw new Error(`Sheet '${TBL_CHECKIN_PLAN}' has no header row.`);
  if (logValues.length < 1) throw new Error(`Sheet '${TBL_CHECKIN_LOG}' has no header row.`);

  const aHeaders = attendeeValues[0].map(normalizeHeader);
  const pHeaders = planValues[0].map(normalizeHeader);
  const lHeaders = logValues[0].map(normalizeHeader);
  const aRows = attendeeValues.slice(1);
  const pRows = planValues.slice(1);
  const lRows = logValues.slice(1);

  const aTraineeIdx = aHeaders.indexOf("trainee id");
  const aSectionIdx = aHeaders.indexOf("section id");
  if (aTraineeIdx === -1 || aSectionIdx === -1) {
    throw new Error("Missing columns in attendee management sheet: trainee id / section id.");
  }

  const isRegistered = aRows.some(row =>
    normalizeEmail(row[aTraineeIdx]) === cleanEmail &&
    String(row[aSectionIdx] || "").trim() === safeSectionId
  );
  if (!isRegistered) {
    return {
      status: "Forbidden",
      message: "Trainee is not registered for this section.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      googleUpdatedCells: 0
    };
  }

  const pSlotIdx = pHeaders.indexOf("checkin slot id");
  const pSectionIdx = pHeaders.indexOf("section id");
  const pCodeIdx = pHeaders.indexOf("checkin code");
  if (pSlotIdx === -1) throw new Error(`Missing 'checkin slot id' column in '${TBL_CHECKIN_PLAN}'.`);
  if (pSectionIdx === -1) throw new Error(`Missing 'section id' column in '${TBL_CHECKIN_PLAN}'.`);
  if (pCodeIdx === -1) throw new Error(`Missing 'checkin code' column in '${TBL_CHECKIN_PLAN}'.`);

  const slotRow = pRows.find(row =>
    String(row[pSlotIdx] || "").trim() === safeSlotId &&
    String(row[pSectionIdx] || "").trim() === safeSectionId
  );
  if (!slotRow) {
    return {
      status: "Slot Not Found",
      message: "Check-in slot not found for this section.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      googleUpdatedCells: 0
    };
  }

  const realCode = String(slotRow[pCodeIdx] || "").toLowerCase().trim();
  if (realCode !== cleanInputCode) {
    return {
      status: "Incorrect Code",
      message: "Incorrect check-in code. Please try again.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      googleUpdatedCells: 0
    };
  }

  const timeWindow = buildCheckinTimeWindow(slotRow, pHeaders);
  if (timeWindow.enforced && !timeWindow.valid) {
    return {
      status: "Invalid Time Window",
      message: timeWindow.reason || "Invalid check-in time window configuration.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      timeWindow,
      googleUpdatedCells: 0
    };
  }
  if (timeWindow.enforced && !timeWindow.isOpen) {
    return {
      status: "Time Window Closed",
      message: `Check-in is only allowed from ${timeWindow.validFrom} to ${timeWindow.validTo}.`,
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      timeWindow,
      googleUpdatedCells: 0
    };
  }

  const lSlotIdx = lHeaders.indexOf("checkin slot id");
  const lSectionIdx = lHeaders.indexOf("section id");
  const lTraineeIdx = lHeaders.indexOf("trainee id");
  const lAttendeeIdIdx = lHeaders.indexOf("section attendee id");
  const sectionAttendeeId = `${cleanEmail}_${safeSlotId}`;

  const duplicate = lRows.some(row => {
    const rowSlot = lSlotIdx !== -1 ? String(row[lSlotIdx] || "").trim() : "";
    const rowSection = lSectionIdx !== -1 ? String(row[lSectionIdx] || "").trim() : "";
    const rowTrainee = lTraineeIdx !== -1 ? normalizeEmail(row[lTraineeIdx]) : "";
    const rowAttendeeId = lAttendeeIdIdx !== -1 ? String(row[lAttendeeIdIdx] || "").trim() : "";
    return (rowSlot === safeSlotId && rowSection === safeSectionId && rowTrainee === cleanEmail) || rowAttendeeId === sectionAttendeeId;
  });

  if (duplicate) {
    return {
      status: "Already Checked In",
      message: "You have already checked in for this slot.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: true,
      duplicate: true,
      googleUpdatedCells: 0
    };
  }

  const now = formatVietnamDateTime(new Date());
  const newRow = new Array(lHeaders.length).fill("");
  const mapping = {
    "section attendee id": sectionAttendeeId,
    "checkin slot id": safeSlotId,
    "section id": safeSectionId,
    "trainee id": cleanEmail,
    "checkin datetime": now,
    "checkin time": now,
    "checkin at": now,
    "checked in at": now,
    "timestamp": now,
    "updated at": now,
    "updated by": cleanEmail
  };

  const updatedFields = [];
  for (const [header, value] of Object.entries(mapping)) {
    const colIdx = lHeaders.indexOf(header);
    if (colIdx !== -1) {
      newRow[colIdx] = value;
      updatedFields.push(header);
    }
  }

  // Fallback to the original GAS append order if the sheet has sparse/nonstandard headers.
  if (!updatedFields.includes("section attendee id") && newRow.length >= 1) { newRow[0] = sectionAttendeeId; updatedFields.push("col1:section attendee id"); }
  if (!updatedFields.includes("checkin slot id") && newRow.length >= 2) { newRow[1] = safeSlotId; updatedFields.push("col2:checkin slot id"); }
  if (!updatedFields.includes("section id") && newRow.length >= 3) { newRow[2] = safeSectionId; updatedFields.push("col3:section id"); }
  if (!updatedFields.includes("trainee id") && newRow.length >= 4) { newRow[3] = cleanEmail; updatedFields.push("col4:trainee id"); }
  if (!updatedFields.some(h => h.includes("datetime") || h.includes("time") || h.includes("timestamp") || h.includes("checked in") || h === "updated at") && newRow.length >= 5) {
    newRow[4] = now;
    updatedFields.push("col5:checkin timestamp");
  }

  if (updatedFields.length === 0) throw new Error("Check-in log sheet has no usable columns for append.");

  let googleResult = null;
  if (!dryRun) googleResult = await appendSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_LOG", TBL_CHECKIN_LOG))}!A:ZZ`, [newRow]);

  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No check-in log was appended." : "Check-in successful!",
    sectionId: safeSectionId,
    slotId: safeSlotId,
    traineeEmail: cleanEmail,
    checkedIn: !dryRun,
    dryRun,
    timeWindow,
    updatedFields: unique(updatedFields),
    updatedCellCount: updatedFields.length,
    googleUpdatedCells: googleResult?.updates?.updatedCells ?? 0
  };
}

function rowToObject(row, headers) {
  const obj = {};
  headers.forEach((header, index) => {
    if (!header) return;
    obj[header] = row[index] ?? "";
  });
  return obj;
}

function lookupCourseName(values, courseId) {
  const safeCourseId = String(courseId || "").trim();
  if (!safeCourseId || !Array.isArray(values) || values.length < 1) return "";
  const headers = values[0].map(normalizeHeader);
  const idIdx = headers.indexOf("course id");
  if (idIdx === -1) return "";
  const row = values.slice(1).find(r => String(r[idIdx] || "").trim() === safeCourseId);
  if (!row) return "";
  return getByHeader(row, headers, "course name en") || getByHeader(row, headers, "course name") || "";
}

function lookupRoomTitle(values, roomId) {
  const safeRoomId = String(roomId || "").trim();
  if (!safeRoomId || !Array.isArray(values) || values.length < 1) return "";
  const headers = values[0].map(normalizeHeader);
  const idIdx = headers.indexOf("facility id");
  if (idIdx === -1) return "";
  const row = values.slice(1).find(r => String(r[idIdx] || "").trim() === safeRoomId);
  if (!row) return "";
  return getByHeader(row, headers, "facility name") || getByHeader(row, headers, "room title") || "";
}

function getByHeader(row, headers, headerName) {
  const idx = headers.indexOf(headerName);
  return idx !== -1 ? String(row[idx] ?? "") : "";
}

function parseSheetDate(value, fallback, isEndDate = false) {
  let d = null;
  const raw = String(value || "").trim().split(/\n|<br\s*\/?>/i)[0].trim();
  if (!raw) d = new Date(fallback);
  else {
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    else d = new Date(raw);
  }
  if (!d || Number.isNaN(d.getTime())) d = new Date(fallback);
  if (isEndDate) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}


// =========================
// Step 22: Trainee History + Feedback read-only helpers
// =========================
export const TBL_FB_FORMS = "pdc_fb_forms";
export const TBL_FB_QUESTIONS = "pdc_fb_questions";
export const TBL_FB_SUBMISSIONS = "pdc_fb_submissions";
export const TBL_FB_RESPONSES = "pdc_fb_responses";
export const TBL_FB_SECTIONFORMS = "pdc_fb_sectionforms";

function getFeedbackSpreadsheetId(env) {
  const spreadsheetId = String(env.GOOGLE_SHEET_ID_FEEDBACK || "").trim();
  if (!spreadsheetId) return null;
  return spreadsheetId;
}

function getFeedbackSpreadsheetIdRequired(env) {
  const spreadsheetId = getFeedbackSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_FEEDBACK.");
  return spreadsheetId;
}

function headerIndex(headers, names) {
  for (const name of names) {
    const idx = headers.indexOf(normalizeHeader(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

function valueByHeaders(row, headers, names, fallback = "") {
  const idx = headerIndex(headers, Array.isArray(names) ? names : [names]);
  return idx !== -1 ? (row[idx] ?? fallback) : fallback;
}

function safeLower(value) {
  return String(value || "").toLowerCase().trim();
}

function isTruthyCell(value) {
  const v = safeLower(value);
  return ["true", "yes", "y", "1", "active"].includes(v);
}

function feedbackVietnamLocalToUtcDate(year, month, day, hour = 0, minute = 0, second = 0) {
  // Vietnam is UTC+7. Treat sheet values without timezone as Vietnam local time.
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 7, Number(minute), Number(second || 0)));
}

function parseFeedbackDate(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(fallback);

  // Explicit ISO values with timezone should be trusted as absolute instants.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const iso = new Date(raw);
    if (!Number.isNaN(iso.getTime())) return iso;
  }

  // Google Sheet feedback dates are dd/mm/yyyy HH:mm:ss in Vietnam local time.
  // Parse this BEFORE new Date(raw), otherwise 01/06/2026 can become Jan 6 in JS.
  let m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return feedbackVietnamLocalToUtcDate(m[3], m[2], m[1], m[4] || 0, m[5] || 0, m[6] || 0);
  }

  // dd/May/yyyy HH:mm:ss, also Vietnam local time.
  m = raw.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3,})[\/\-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
    const month = months[String(m[2]).toLowerCase()];
    if (month) return feedbackVietnamLocalToUtcDate(m[3], month, m[1], m[4] || 0, m[5] || 0, m[6] || 0);
  }

  // yyyy-mm-dd or yyyy/mm/dd without timezone: treat as Vietnam local time.
  m = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return feedbackVietnamLocalToUtcDate(m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0);
  }

  const d1 = new Date(raw);
  if (!Number.isNaN(d1.getTime())) return d1;
  return new Date(fallback);
}

function formatPercentageCell(value) {
  if (value === undefined || value === null || value === "") return "0%";
  const raw = String(value).trim();
  if (raw.includes("%")) return raw;
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
    return `${Math.round(n)}%`;
  }
  return raw;
}

export async function getRegisteredSectionIdsForTrainee(env, email) {
  const cleanEmail = normalizeEmail(email);
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");
  const attendeeResult = await getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`);
  const values = Array.isArray(attendeeResult.values) ? attendeeResult.values : [];
  if (values.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);
  const headers = values[0].map(normalizeHeader);
  const rows = values.slice(1);
  const traineeIdx = headers.indexOf("trainee id");
  const sectionIdx = headers.indexOf("section id");
  if (traineeIdx === -1 || sectionIdx === -1) throw new Error("Missing attendee columns: trainee id / section id.");
  const ids = new Set();
  for (const row of rows) {
    if (normalizeEmail(row[traineeIdx]) === cleanEmail) {
      const id = String(row[sectionIdx] || "").trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

export async function getTraineeFeedbackProgressMapFromSheet(env, email) {
  const cleanEmail = normalizeEmail(email);
  const fbSpreadsheetId = getFeedbackSpreadsheetIdRequired(env);
  const [sectionFormsResult, submissionsResult] = await Promise.all([
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SECTIONFORMS", TBL_FB_SECTIONFORMS))}!A:ZZ`).catch(() => ({ values: [] })),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SUBMISSIONS", TBL_FB_SUBMISSIONS))}!A:ZZ`).catch(() => ({ values: [] }))
  ]);

  const sfValues = Array.isArray(sectionFormsResult.values) ? sectionFormsResult.values : [];
  if (sfValues.length < 1) return {};
  const sfHeaders = sfValues[0].map(normalizeHeader);
  const sfRows = sfValues.slice(1);
  const sfIdIdx = headerIndex(sfHeaders, ["id", "mapping_id", "mapping id"]);
  const sfSecIdx = headerIndex(sfHeaders, ["section id", "section_id"]);
  if (sfIdIdx === -1 || sfSecIdx === -1) return {};

  const subValues = Array.isArray(submissionsResult.values) ? submissionsResult.values : [];
  const completedMappingIds = new Set();
  if (subValues.length > 0) {
    const subHeaders = subValues[0].map(normalizeHeader);
    const subRows = subValues.slice(1);
    const subMapIdx = headerIndex(subHeaders, ["mapping_id", "mapping id"]);
    const subTraineeIdx = headerIndex(subHeaders, ["trainee_id", "trainee id", "user_email", "user email"]);
    if (subMapIdx !== -1 && subTraineeIdx !== -1) {
      for (const row of subRows) {
        if (normalizeEmail(row[subTraineeIdx]) === cleanEmail) {
          const mappingId = String(row[subMapIdx] || "").trim();
          if (mappingId) completedMappingIds.add(mappingId);
        }
      }
    }
  }

  const progressMap = {};
  for (const row of sfRows) {
    const sectionId = String(row[sfSecIdx] || "").trim();
    const mappingId = String(row[sfIdIdx] || "").trim();
    if (!sectionId || !mappingId) continue;
    if (!progressMap[sectionId]) progressMap[sectionId] = { total: 0, completed: 0, percentage: 0 };
    progressMap[sectionId].total += 1;
    if (completedMappingIds.has(mappingId)) progressMap[sectionId].completed += 1;
  }
  for (const sectionId of Object.keys(progressMap)) {
    const item = progressMap[sectionId];
    item.percentage = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
  }
  return progressMap;
}

export async function getTraineeHistoryFromSheet(env, traineeEmail, options = {}) {
  const cleanEmail = normalizeEmail(traineeEmail);
  const spreadsheetId = getCoreSpreadsheetId(env);
  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEET_ID_CORE.");

  const [attendeeData, sectionData, planData, logData] = await Promise.all([
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION_ATTENDEE", TBL_ATTENDEE))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "SECTION", TBL_SECTION))}!A:ZZ`, options),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_PLAN", TBL_CHECKIN_PLAN))}!A:ZZ`, options).catch(() => ({ values: [] })),
    getSheetValues(env, spreadsheetId, `${quoteSheetName(tableSheet(env, "CHECKIN_LOG", TBL_CHECKIN_LOG))}!A:ZZ`, options).catch(() => ({ values: [] })),
  ]);

  const aValues = Array.isArray(attendeeData.values) ? attendeeData.values : [];
  const sValues = Array.isArray(sectionData.values) ? sectionData.values : [];
  const pValues = Array.isArray(planData.values) ? planData.values : [];
  const lValues = Array.isArray(logData.values) ? logData.values : [];
  if (aValues.length < 1) throw new Error(`Sheet '${TBL_ATTENDEE}' has no header row.`);
  if (sValues.length < 1) throw new Error(`Sheet '${TBL_SECTION}' has no header row.`);

  const fbMap = await getTraineeFeedbackProgressMapFromSheet(env, cleanEmail).catch(() => ({}));

  const aHeaders = aValues[0].map(normalizeHeader);
  const sHeaders = sValues[0].map(normalizeHeader);
  const pHeaders = pValues.length > 0 ? pValues[0].map(normalizeHeader) : [];
  const lHeaders = lValues.length > 0 ? lValues[0].map(normalizeHeader) : [];
  const aRows = aValues.slice(1);
  const sRows = sValues.slice(1);
  const pRows = pValues.slice(1);
  const lRows = lValues.slice(1);

  const aEmailIdx = headerIndex(aHeaders, ["trainee id", "trainee email"]);
  const aSecIdx = headerIndex(aHeaders, ["section id"]);
  if (aEmailIdx === -1 || aSecIdx === -1) throw new Error("Missing attendee columns: trainee id / section id.");

  const sSecIdx = headerIndex(sHeaders, ["section id"]);
  const sNameIdx = headerIndex(sHeaders, ["section name en", "section name"]);
  const sDateIdx = headerIndex(sHeaders, ["section date"]);
  const sDateStartIdx = headerIndex(sHeaders, ["date start", "start date", "date start section"]);
  const sStatusIdx = headerIndex(sHeaders, ["section status", "status"]);
  if (sSecIdx === -1) throw new Error("Missing section id in section management sheet.");

  const pSecIdx = headerIndex(pHeaders, ["section id"]);
  const pDateIdx = headerIndex(pHeaders, ["checkin date", "check-in date", "date", "dateid"]);
  const pToIdx = headerIndex(pHeaders, ["checkin valid to", "valid to", "to", "end time", "checkin end time"]);
  const lSecIdx = headerIndex(lHeaders, ["section id"]);
  const lEmailIdx = headerIndex(lHeaders, ["trainee id", "trainee email"]);

  const results = [];
  for (const reg of aRows) {
    if (normalizeEmail(reg[aEmailIdx]) !== cleanEmail) continue;
    const sectionId = String(reg[aSecIdx] || "").trim();
    if (!sectionId) continue;
    const section = sRows.find(row => String(row[sSecIdx] || "").trim() === sectionId) || [];

    const sectionPlans = pSecIdx !== -1 ? pRows.filter(row => String(row[pSecIdx] || "").trim() === sectionId) : [];
    const totalSlots = sectionPlans.length;
    let maxCheckinEndTs = 0;
    for (const plan of sectionPlans) {
      const dateVal = pDateIdx !== -1 ? String(plan[pDateIdx] || "") : "";
      const toVal = pToIdx !== -1 ? String(plan[pToIdx] || "") : "";
      const ts = calculateSlotEndTimestamp(dateVal, toVal);
      if (ts > maxCheckinEndTs) maxCheckinEndTs = ts;
    }

    const userCheckins = (lSecIdx !== -1 && lEmailIdx !== -1) ? lRows.filter(row => String(row[lSecIdx] || "").trim() === sectionId && normalizeEmail(row[lEmailIdx]) === cleanEmail).length : 0;
    const checkin = totalSlots > 0 ? `${userCheckins} / ${totalSlots} (${Math.round((userCheckins / totalSlots) * 100)}%)` : "0%";

    const fb = fbMap[sectionId];
    const feedback = fb && fb.total > 0 ? `${fb.completed} / ${fb.total} (${fb.percentage}%)` : "0%";

    results.push({
      sectionId,
      sectionNameEn: sNameIdx !== -1 ? String(section[sNameIdx] || "Unknown") : "Unknown",
      status: sStatusIdx !== -1 ? String(section[sStatusIdx] || "Unknown") : "Unknown",
      sectionDate: sDateIdx !== -1 ? String(section[sDateIdx] || "N/A").replace(/\n/g, "<br>") : "N/A",
      dateStart: sDateStartIdx !== -1 ? String(section[sDateStartIdx] || "") : "",
      checkinEndTimestamp: maxCheckinEndTs,
      registeredAt: String(valueByHeaders(reg, aHeaders, ["registered at", "registration datetime", "created at"], "N/A") || "N/A"),
      checkin,
      assessment: formatPercentageCell(valueByHeaders(reg, aHeaders, ["assessment completion"], "")),
      feedback,
      certIssued: String(valueByHeaders(reg, aHeaders, ["certificate file issued", "certificate", "certificate url"], "") || "")
    });
  }

  return { count: results.length, data: results };
}

async function assertTraineeRegisteredForSection(env, email, sectionId) {
  const registeredIds = await getRegisteredSectionIdsForTrainee(env, email);
  return registeredIds.has(String(sectionId || "").trim());
}

export async function getFormsForSectionFromSheet(env, traineeEmail, sectionId, options = {}) {
  const cleanEmail = normalizeEmail(traineeEmail);
  const safeSectionId = String(sectionId || "").trim();
  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeSectionId) throw new Error("Missing sectionId.");
  const isRegistered = await assertTraineeRegisteredForSection(env, cleanEmail, safeSectionId);
  if (!isRegistered) return { allowed: false, data: [], count: 0, message: "Trainee is not registered for this section." };

  const fbSpreadsheetId = getFeedbackSpreadsheetIdRequired(env);
  const [sfResult, formsResult, submissionsResult] = await Promise.all([
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SECTIONFORMS", TBL_FB_SECTIONFORMS))}!A:ZZ`, options),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_FORMS", TBL_FB_FORMS))}!A:ZZ`, options),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SUBMISSIONS", TBL_FB_SUBMISSIONS))}!A:ZZ`, options).catch(() => ({ values: [] }))
  ]);

  const sfValues = Array.isArray(sfResult.values) ? sfResult.values : [];
  const fValues = Array.isArray(formsResult.values) ? formsResult.values : [];
  const subValues = Array.isArray(submissionsResult.values) ? submissionsResult.values : [];
  if (sfValues.length < 1) throw new Error(`Sheet '${TBL_FB_SECTIONFORMS}' has no header row.`);
  if (fValues.length < 1) throw new Error(`Sheet '${TBL_FB_FORMS}' has no header row.`);

  const sfHeaders = sfValues[0].map(normalizeHeader);
  const fHeaders = fValues[0].map(normalizeHeader);
  const subHeaders = subValues.length > 0 ? subValues[0].map(normalizeHeader) : [];
  const sfRows = sfValues.slice(1);
  const fRows = fValues.slice(1);
  const subRows = subValues.slice(1);

  const sfIdIdx = headerIndex(sfHeaders, ["id", "mapping_id", "mapping id"]);
  const sfSecIdx = headerIndex(sfHeaders, ["section id", "section_id"]);
  const sfFormIdx = headerIndex(sfHeaders, ["form_id", "form id"]);
  const sfTitleIdx = headerIndex(sfHeaders, ["form_title", "form title"]);
  const sfStartIdx = headerIndex(sfHeaders, ["response starttime", "response start time", "starttime", "start time"]);
  const sfEndIdx = headerIndex(sfHeaders, ["response endtime", "response end time", "endtime", "end time"]);
  if (sfSecIdx === -1 || sfFormIdx === -1) throw new Error("Feedback sectionforms sheet missing section/form columns.");

  const fIdIdx = headerIndex(fHeaders, ["form_id", "form id"]);
  const fTitleIdx = headerIndex(fHeaders, ["title", "form title"]);
  const fDescIdx = headerIndex(fHeaders, ["description"]);
  const fActiveIdx = headerIndex(fHeaders, ["is_active", "is active", "active"]);

  const subMapIdx = headerIndex(subHeaders, ["mapping_id", "mapping id"]);
  const subTraineeIdx = headerIndex(subHeaders, ["trainee_id", "trainee id", "user_email", "user email"]);
  const completedMappingIds = new Set();
  if (subMapIdx !== -1 && subTraineeIdx !== -1) {
    for (const row of subRows) {
      if (normalizeEmail(row[subTraineeIdx]) === cleanEmail) {
        const mappingId = String(row[subMapIdx] || "").trim();
        if (mappingId) completedMappingIds.add(mappingId);
      }
    }
  }

  const now = new Date();
  const results = [];
  for (const mapping of sfRows.filter(row => String(row[sfSecIdx] || "").trim() === safeSectionId)) {
    const mappingId = sfIdIdx !== -1 ? String(mapping[sfIdIdx] || "").trim() : "";
    const formId = String(mapping[sfFormIdx] || "").trim();
    if (!formId) continue;
    const formRow = fRows.find(row => String(row[fIdIdx] || "").trim() === formId);
    if (!formRow) continue;
    if (fActiveIdx !== -1 && !isTruthyCell(formRow[fActiveIdx])) continue;

    const startTime = parseFeedbackDate(sfStartIdx !== -1 ? mapping[sfStartIdx] : "", "2000-01-01T00:00:00+07:00");
    const endTime = parseFeedbackDate(sfEndIdx !== -1 ? mapping[sfEndIdx] : "", "2099-12-31T23:59:59+07:00");
    const isCompleted = mappingId && completedMappingIds.has(mappingId);
    const status = isCompleted ? "Completed" : (now < startTime) ? "In-Active" : (now > endTime) ? "Missed" : "Active";
    const customTitle = sfTitleIdx !== -1 ? String(mapping[sfTitleIdx] || "").trim() : "";
    const defaultTitle = fTitleIdx !== -1 ? String(formRow[fTitleIdx] || "").trim() : formId;

    results.push({
      mappingId,
      formId,
      sectionId: safeSectionId,
      title: customTitle || defaultTitle,
      description: fDescIdx !== -1 ? String(formRow[fDescIdx] || "") : "",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status
    });
  }
  results.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  return { allowed: true, count: results.length, data: results };
}

export async function getFormQuestionsFromSheet(env, email, formId, mappingId = "") {
  const cleanEmail = normalizeEmail(email);
  const safeFormId = String(formId || "").trim();
  const safeMappingId = String(mappingId || "").trim();
  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeFormId) throw new Error("Missing formId.");

  const registeredIds = await getRegisteredSectionIdsForTrainee(env, cleanEmail);
  const fbSpreadsheetId = getFeedbackSpreadsheetIdRequired(env);
  const [sfResult, qResult] = await Promise.all([
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SECTIONFORMS", TBL_FB_SECTIONFORMS))}!A:ZZ`),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_QUESTIONS", TBL_FB_QUESTIONS))}!A:ZZ`)
  ]);

  const sfValues = Array.isArray(sfResult.values) ? sfResult.values : [];
  const qValues = Array.isArray(qResult.values) ? qResult.values : [];
  if (sfValues.length < 1) throw new Error(`Sheet '${TBL_FB_SECTIONFORMS}' has no header row.`);
  if (qValues.length < 1) throw new Error(`Sheet '${TBL_FB_QUESTIONS}' has no header row.`);

  const sfHeaders = sfValues[0].map(normalizeHeader);
  const qHeaders = qValues[0].map(normalizeHeader);
  const sfRows = sfValues.slice(1);
  const qRows = qValues.slice(1);
  const sfIdIdx = headerIndex(sfHeaders, ["id", "mapping_id", "mapping id"]);
  const sfSecIdx = headerIndex(sfHeaders, ["section id", "section_id"]);
  const sfFormIdx = headerIndex(sfHeaders, ["form_id", "form id"]);

  const accessible = sfRows.some(row => {
    const rowFormId = String(row[sfFormIdx] || "").trim();
    const rowMappingId = sfIdIdx !== -1 ? String(row[sfIdIdx] || "").trim() : "";
    const rowSectionId = String(row[sfSecIdx] || "").trim();
    if (rowFormId !== safeFormId) return false;
    if (safeMappingId && rowMappingId !== safeMappingId) return false;
    return registeredIds.has(rowSectionId);
  });
  if (!accessible) return { allowed: false, count: 0, data: [], message: "Trainee does not have access to this form." };

  const formIdx = headerIndex(qHeaders, ["form_id", "form id"]);
  const questionIdx = headerIndex(qHeaders, ["question_id", "question id"]);
  const textIdx = headerIndex(qHeaders, ["question_text", "question text", "text"]);
  const typeIdx = headerIndex(qHeaders, ["question_type", "question type", "type"]);
  const optionsIdx = headerIndex(qHeaders, ["options"]);
  const requiredIdx = headerIndex(qHeaders, ["is_required", "is required", "required"]);
  const sortIdx = headerIndex(qHeaders, ["sort_order", "sort order", "order"]);
  if (formIdx === -1) throw new Error("Feedback questions sheet missing form_id column.");

  const questions = qRows
    .filter(row => String(row[formIdx] || "").trim() === safeFormId)
    .map(row => ({
      questionId: questionIdx !== -1 ? String(row[questionIdx] || "") : "",
      text: textIdx !== -1 ? String(row[textIdx] || "") : "",
      type: typeIdx !== -1 ? String(row[typeIdx] || "").toLowerCase().trim() : "text",
      options: optionsIdx !== -1 ? String(row[optionsIdx] || "") : "",
      isRequired: requiredIdx !== -1 ? isTruthyCell(row[requiredIdx]) : false,
      sortOrder: sortIdx !== -1 ? (Number(row[sortIdx]) || 0) : 0
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return { allowed: true, count: questions.length, data: questions };
}


// =========================
// Step 23: Feedback submission helper
// =========================
export async function submitFeedbackFormToSheet(env, email, formId, mappingId, answersArray, dryRun = true) {
  const cleanEmail = normalizeEmail(email);
  const safeFormId = String(formId || "").trim();
  const safeMappingId = String(mappingId || "").trim();
  if (!cleanEmail) throw new Error("Missing trainee email.");
  if (!safeFormId) throw new Error("Missing formId.");
  if (!safeMappingId) throw new Error("Missing mappingId.");
  if (!Array.isArray(answersArray)) throw new Error("answers must be an array.");

  const fbSpreadsheetId = getFeedbackSpreadsheetIdRequired(env);
  const [sfResult, formsResult, questionsResult, submissionsResult, responsesResult] = await Promise.all([
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SECTIONFORMS", TBL_FB_SECTIONFORMS))}!A:ZZ`, { bypassCache: true }),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_FORMS", TBL_FB_FORMS))}!A:ZZ`, { bypassCache: true }),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_QUESTIONS", TBL_FB_QUESTIONS))}!A:ZZ`, { bypassCache: true }),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SUBMISSIONS", TBL_FB_SUBMISSIONS))}!A:ZZ`, { bypassCache: true }),
    getSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_RESPONSES", TBL_FB_RESPONSES))}!A:ZZ`, { bypassCache: true })
  ]);

  const sfValues = Array.isArray(sfResult.values) ? sfResult.values : [];
  const fValues = Array.isArray(formsResult.values) ? formsResult.values : [];
  const qValues = Array.isArray(questionsResult.values) ? questionsResult.values : [];
  const subValues = Array.isArray(submissionsResult.values) ? submissionsResult.values : [];
  const respValues = Array.isArray(responsesResult.values) ? responsesResult.values : [];
  if (sfValues.length < 1) throw new Error(`Sheet '${TBL_FB_SECTIONFORMS}' has no header row.`);
  if (fValues.length < 1) throw new Error(`Sheet '${TBL_FB_FORMS}' has no header row.`);
  if (qValues.length < 1) throw new Error(`Sheet '${TBL_FB_QUESTIONS}' has no header row.`);
  if (subValues.length < 1) throw new Error(`Sheet '${TBL_FB_SUBMISSIONS}' has no header row.`);
  if (respValues.length < 1) throw new Error(`Sheet '${TBL_FB_RESPONSES}' has no header row.`);

  const sfHeaders = sfValues[0].map(normalizeHeader);
  const fHeaders = fValues[0].map(normalizeHeader);
  const qHeaders = qValues[0].map(normalizeHeader);
  const subHeaders = subValues[0].map(normalizeHeader);
  const respHeaders = respValues[0].map(normalizeHeader);
  const sfRows = sfValues.slice(1);
  const fRows = fValues.slice(1);
  const qRows = qValues.slice(1);
  const subRows = subValues.slice(1);

  const sfIdIdx = headerIndex(sfHeaders, ["id", "mapping_id", "mapping id"]);
  const sfSecIdx = headerIndex(sfHeaders, ["section id", "section_id"]);
  const sfFormIdx = headerIndex(sfHeaders, ["form_id", "form id"]);
  const sfStartIdx = headerIndex(sfHeaders, ["response starttime", "response start time", "starttime", "start time"]);
  const sfEndIdx = headerIndex(sfHeaders, ["response endtime", "response end time", "endtime", "end time"]);
  if (sfIdIdx === -1 || sfSecIdx === -1 || sfFormIdx === -1) throw new Error("Feedback sectionforms sheet missing required id/section/form columns.");

  const mappingRow = sfRows.find(row =>
    String(row[sfIdIdx] || "").trim() === safeMappingId &&
    String(row[sfFormIdx] || "").trim() === safeFormId
  );
  if (!mappingRow) {
    return { status: "Mapping Not Found", message: "Feedback form mapping was not found.", submitted: false, googleUpdatedCells: 0 };
  }

  const sectionId = String(mappingRow[sfSecIdx] || "").trim();
  const registered = await assertTraineeRegisteredForSection(env, cleanEmail, sectionId);
  if (!registered) {
    return { status: "Forbidden", message: "Trainee is not registered for this form's section.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };
  }

  const fIdIdx = headerIndex(fHeaders, ["form_id", "form id"]);
  const fActiveIdx = headerIndex(fHeaders, ["is_active", "is active", "active"]);
  const formRow = fRows.find(row => String(row[fIdIdx] || "").trim() === safeFormId);
  if (!formRow) return { status: "Form Not Found", message: "Feedback form was not found.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };
  if (fActiveIdx !== -1 && !isTruthyCell(formRow[fActiveIdx])) {
    return { status: "Form Inactive", message: "This feedback form is inactive.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };
  }

  const startTime = parseFeedbackDate(sfStartIdx !== -1 ? mappingRow[sfStartIdx] : "", "2000-01-01T00:00:00+07:00");
  const endTime = parseFeedbackDate(sfEndIdx !== -1 ? mappingRow[sfEndIdx] : "", "2099-12-31T23:59:59+07:00");
  const now = new Date();
  const timeWindow = {
    enforced: true,
    isOpen: now >= startTime && now <= endTime,
    now: now.toISOString(),
    validFrom: startTime.toISOString(),
    validTo: endTime.toISOString(),
    startValue: sfStartIdx !== -1 ? String(mappingRow[sfStartIdx] || "") : "",
    endValue: sfEndIdx !== -1 ? String(mappingRow[sfEndIdx] || "") : ""
  };
  if (!timeWindow.isOpen) {
    const status = now < startTime ? "In-Active" : "Missed";
    return { status, message: `Feedback submission is only allowed from ${timeWindow.validFrom} to ${timeWindow.validTo}.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, timeWindow, googleUpdatedCells: 0 };
  }

  const subMapIdx = headerIndex(subHeaders, ["mapping_id", "mapping id"]);
  const subFormIdx = headerIndex(subHeaders, ["form_id", "form id"]);
  const subTraineeIdx = headerIndex(subHeaders, ["trainee_id", "trainee id", "user_email", "user email"]);
  const duplicate = subRows.some(row =>
    (subMapIdx === -1 || String(row[subMapIdx] || "").trim() === safeMappingId) &&
    (subFormIdx === -1 || String(row[subFormIdx] || "").trim() === safeFormId) &&
    subTraineeIdx !== -1 && normalizeEmail(row[subTraineeIdx]) === cleanEmail
  );
  if (duplicate) {
    return { status: "Already Submitted", message: "You have already submitted this feedback form.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: true, duplicate: true, googleUpdatedCells: 0 };
  }

  const qFormIdx = headerIndex(qHeaders, ["form_id", "form id"]);
  const qIdIdx = headerIndex(qHeaders, ["question_id", "question id"]);
  const qReqIdx = headerIndex(qHeaders, ["is_required", "is required", "required"]);
  if (qFormIdx === -1 || qIdIdx === -1) throw new Error("Feedback questions sheet missing form/question id columns.");
  const questions = qRows.filter(row => String(row[qFormIdx] || "").trim() === safeFormId);
  const validQuestionIds = new Set(questions.map(row => String(row[qIdIdx] || "").trim()).filter(Boolean));
  const answerMap = new Map();
  for (const ans of answersArray) {
    const qid = String(ans?.questionId || ans?.question_id || "").trim();
    if (!qid) continue;
    if (!validQuestionIds.has(qid)) return { status: "Invalid Question", message: `Question ${qid} does not belong to this form.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };
    answerMap.set(qid, ans?.answer ?? ans?.answer_value ?? "");
  }
  for (const q of questions) {
    const qid = String(q[qIdIdx] || "").trim();
    const required = qReqIdx !== -1 ? isTruthyCell(q[qReqIdx]) : false;
    if (required && (!answerMap.has(qid) || String(answerMap.get(qid) ?? "").trim() === "")) {
      return { status: "Missing Required Answer", message: `Missing required answer for question ${qid}.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };
    }
  }

  const submittedAt = formatVietnamDateTime(new Date());
  const submissionId = `SUB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const subRow = new Array(subHeaders.length).fill("");
  const subMap = {
    "submission_id": submissionId,
    "submission id": submissionId,
    "form_id": safeFormId,
    "form id": safeFormId,
    "mapping_id": safeMappingId,
    "mapping id": safeMappingId,
    "user_email": cleanEmail,
    "user email": cleanEmail,
    "trainee_id": cleanEmail,
    "trainee id": cleanEmail,
    "submitted_at": submittedAt,
    "submitted at": submittedAt,
    "section id": sectionId,
    "section_id": sectionId
  };
  const subUpdatedFields = [];
  subHeaders.forEach((h, idx) => {
    if (subMap[h] !== undefined) { subRow[idx] = subMap[h]; subUpdatedFields.push(h); }
  });
  if (subUpdatedFields.length === 0) throw new Error("Feedback submissions sheet has no usable columns for append.");

  const responseRows = [];
  const respUpdatedFields = new Set();
  let counter = 1;
  for (const [questionId, answer] of answerMap.entries()) {
    const respRow = new Array(respHeaders.length).fill("");
    const responseId = `${submissionId}-R${counter++}`;
    const respMap = {
      "response_id": responseId,
      "response id": responseId,
      "submission_id": submissionId,
      "submission id": submissionId,
      "question_id": questionId,
      "question id": questionId,
      "answer_value": answer,
      "answer value": answer,
      "answer": answer
    };
    respHeaders.forEach((h, idx) => {
      if (respMap[h] !== undefined) { respRow[idx] = respMap[h]; respUpdatedFields.add(h); }
    });
    responseRows.push(respRow);
  }
  if (responseRows.length === 0) return { status: "No Answers", message: "No valid answers were submitted.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, googleUpdatedCells: 0 };

  let subResult = null;
  let respResult = null;
  if (!dryRun) {
    subResult = await appendSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_SUBMISSIONS", TBL_FB_SUBMISSIONS))}!A:ZZ`, [subRow]);
    respResult = await appendSheetValues(env, fbSpreadsheetId, `${quoteSheetName(tableSheet(env, "FB_RESPONSES", TBL_FB_RESPONSES))}!A:ZZ`, responseRows);
  }

  const googleUpdatedCells = (subResult?.updates?.updatedCells || 0) + (respResult?.updates?.updatedCells || 0);
  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No feedback rows were appended." : "Feedback submitted successfully.",
    sectionId,
    formId: safeFormId,
    mappingId: safeMappingId,
    submissionId,
    traineeEmail: cleanEmail,
    submitted: !dryRun,
    dryRun,
    timeWindow,
    questionCount: questions.length,
    answerCount: responseRows.length,
    updatedFields: {
      submissions: unique(subUpdatedFields),
      responses: unique([...respUpdatedFields])
    },
    googleUpdatedCells
  };
}
