import { psqlFindOne, psqlInsertRow, psqlSelectRows } from "../psql-adapter.js";
import { cleanEmail, nowVietnamLocal } from "./repo-utils.js";
import { getRegistrationPsql } from "./registration-repo.js";

export async function listCheckinPlansForSectionPsql(env, sectionId, options = {}) {
  return psqlSelectRows(env, "CHECKIN_PLAN", {
    where: { "section id": String(sectionId || "").trim() },
    orderBy: options.orderBy || [{ column: "checkin date", direction: "ASC" }, { column: "checkin valid from", direction: "ASC" }],
    limit: options.limit || 100
  });
}

export async function getCheckinSlotPsql(env, slotId) {
  return psqlFindOne(env, "CHECKIN_PLAN", { "checkin slot id": String(slotId || "").trim() });
}

export async function listCheckinLogsForTraineePsql(env, email, sectionId, options = {}) {
  const where = { "trainee id": cleanEmail(email) };
  if (sectionId) where["section id"] = String(sectionId || "").trim();
  return psqlSelectRows(env, "CHECKIN_LOG", { where, limit: options.limit || 500 });
}

export async function getCheckinLogPsql(env, email, slotId, options = {}) {
  return psqlFindOne(env, "CHECKIN_LOG", {
    "trainee id": cleanEmail(email),
    "checkin slot id": String(slotId || "").trim()
  }, options);
}

export async function insertCheckinLogPsql(env, email, sectionId, slotId, data = {}, options = {}) {
  const clean = cleanEmail(email);
  const sid = String(sectionId || "").trim();
  const slot = String(slotId || "").trim();
  const existing = await getCheckinLogPsql(env, clean, slot, { bypassCache: true });
  if (existing) return { action: "existing", row: existing, rowCount: 0 };
  return psqlInsertRow(env, "CHECKIN_LOG", {
    "section attendee id": data["section attendee id"] || `${clean}_${slot}`,
    "checkin slot id": slot,
    "section id": sid,
    "trainee id": clean,
    "checkin time stamp": data["checkin time stamp"] || data["checkin timestamp"] || nowVietnamLocal()
  }, options);
}

function buildCheckinTimeWindowPsql(slotRow) {
  const typeValue = String(slotRow["checkin type"] || slotRow["type"] || "Scheduled Check-In");
  const typeLower = typeValue.toLowerCase().trim();
  const isFlexible = typeLower.includes("flexible");
  const dateValue = slotRow["checkin date"];
  const fromValue = slotRow["checkin valid from"];
  const toValue = slotRow["checkin valid to"];

  if (!dateValue) {
    return { enforced: false, reason: "Missing check-in date; time window not enforced for this slot.", typeValue };
  }

  let dateObj = new Date(dateValue);
  if (Number.isNaN(dateObj.getTime())) {
    return { enforced: true, valid: false, reason: "Invalid check-in date configuration.", typeValue };
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const date = dateObj.getDate();

  let fromHour = 0, fromMin = 0, fromSec = 0;
  let toHour = 23, toMin = 59, toSec = 59;

  if (!isFlexible) {
    if (!fromValue || !toValue) {
      return { enforced: false, reason: "Missing scheduled check-in from/to; time window not enforced for this slot.", typeValue };
    }
    const parseTime = (timeStr) => {
      const parts = String(timeStr).split(":");
      return {
        hour: Number(parts[0] || 0),
        minute: Number(parts[1] || 0),
        second: Number(parts[2] || 0)
      };
    };
    const fParts = parseTime(fromValue);
    const tParts = parseTime(toValue);
    
    fromHour = fParts.hour;
    fromMin = fParts.minute;
    fromSec = fParts.second;
    
    toHour = tParts.hour;
    toMin = tParts.minute;
    toSec = tParts.second;
  }

  const buildDate = (h, m, s) => {
    return new Date(Date.UTC(year, month, date, h - 7, m, s));
  };

  const startMs = buildDate(fromHour, fromMin, fromSec).getTime();
  let endMs = buildDate(toHour, toMin, toSec).getTime();
  if (endMs < startMs) endMs += 24 * 60 * 60 * 1000;

  const nowMs = Date.now();
  const formatTime = (d) => {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(d).replace(",", "");
  };

  return {
    enforced: true,
    valid: true,
    isOpen: nowMs >= startMs && nowMs <= endMs,
    now: formatTime(new Date(nowMs)),
    validFrom: formatTime(new Date(startMs)),
    validTo: formatTime(new Date(endMs)),
    dateValue: String(dateValue),
    fromValue: isFlexible ? "00:00:00" : String(fromValue),
    toValue: isFlexible ? "23:59:59" : String(toValue),
    typeValue,
    rule: isFlexible ? "Flexible date-only check-in window" : "Scheduled date-and-time check-in window"
  };
}

export async function getTraineeCheckinDataPsql(env, email, sectionId, options = {}) {
  const clean = cleanEmail(email);
  const safeSectionId = String(sectionId || "").trim();

  const registration = await getRegistrationPsql(env, clean, safeSectionId);
  if (!registration) {
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

  const plans = await listCheckinPlansForSectionPsql(env, safeSectionId);
  const logs = await listCheckinLogsForTraineePsql(env, clean, safeSectionId);

  return {
    allowed: true,
    sectionId: safeSectionId,
    plans,
    logs,
    planCount: plans.length,
    logCount: logs.length
  };
}

export async function submitTraineeCheckinPsql(env, email, sectionId, slotId, inputCode, dryRun = true) {
  const clean = cleanEmail(email);
  const safeSectionId = String(sectionId || "").trim();
  const safeSlotId = String(slotId || "").trim();
  const cleanInputCode = String(inputCode || "").toLowerCase().trim();

  const registration = await getRegistrationPsql(env, clean, safeSectionId, { bypassCache: true });
  if (!registration) {
    return {
      status: "Forbidden",
      message: "Trainee is not registered for this section.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false
    };
  }

  const slot = await getCheckinSlotPsql(env, safeSlotId);
  if (!slot || String(slot["section id"] || slot["section_id"] || "").trim() !== safeSectionId) {
    return {
      status: "Slot Not Found",
      message: "Check-in slot not found for this section.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false
    };
  }

  const realCode = String(slot["checkin code"] || slot["checkin_code"] || "").toLowerCase().trim();
  if (realCode !== cleanInputCode) {
    return {
      status: "Incorrect Code",
      message: "Incorrect check-in code. Please try again.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false
    };
  }

  const timeWindow = buildCheckinTimeWindowPsql(slot);
  if (timeWindow.enforced && !timeWindow.valid) {
    return {
      status: "Invalid Time Window",
      message: timeWindow.reason || "Invalid check-in time window configuration.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      timeWindow
    };
  }
  if (timeWindow.enforced && !timeWindow.isOpen) {
    return {
      status: "Time Window Closed",
      message: `Check-in is only allowed from ${timeWindow.validFrom} to ${timeWindow.validTo}.`,
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: false,
      timeWindow
    };
  }

  const existingLog = await getCheckinLogPsql(env, clean, safeSlotId, { bypassCache: true });
  if (existingLog) {
    return {
      status: "Already Checked In",
      message: "You have already checked in for this slot.",
      sectionId: safeSectionId,
      slotId: safeSlotId,
      checkedIn: true,
      duplicate: true
    };
  }

  let dbResult = null;
  const sectionAttendeeId = `${clean}_${safeSlotId}`;
  if (!dryRun) {
    dbResult = await insertCheckinLogPsql(env, clean, safeSectionId, safeSlotId, {
      "section attendee id": sectionAttendeeId,
      "checkin time stamp": nowVietnamLocal()
    });
  }

  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No check-in log was appended." : "Check-in successful!",
    sectionId: safeSectionId,
    slotId: safeSlotId,
    traineeEmail: clean,
    checkedIn: !dryRun,
    dryRun,
    timeWindow,
    updatedFields: ["section attendee id", "checkin slot id", "section id", "trainee id", "checkin time stamp"],
    updatedCellCount: 5,
    googleUpdatedCells: dbResult ? 1 : 0
  };
}
