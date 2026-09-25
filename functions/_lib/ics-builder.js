/**
 * Sanitizes and parses the `section calendar date` column into an array of valid YYYY-MM-DD strings.
 * Rules:
 * 1. Split by ","
 * 2. Trim whitespace
 * 3. Remove empties
 * 4. Regex validate YYYY-MM-DD
 * 5. Deduplicate
 * 6. Sort ascending
 * 
 * @param {string} columnValue - The raw column value (e.g., "2026-08-19 , 2026-08-21 , ")
 * @returns {string[]} Array of sanitized YYYY-MM-DD strings
 */
export function parseSectionCalendarDates(columnValue) {
  if (!columnValue || typeof columnValue !== "string") return [];

  const rawSegments = columnValue.split(",");
  const validDates = new Set();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  for (let seg of rawSegments) {
    seg = seg.trim();
    if (!seg) continue;
    
    if (dateRegex.test(seg)) {
      validDates.add(seg);
    } else {
      console.warn(`[ics-builder] Invalid date segment skipped: "${seg}"`);
    }
  }

  return Array.from(validDates).sort();
}

/**
 * Parses the `section date` column into an array of slot objects.
 * Expected format per line: "19/Aug/2026 - Morning - 3 hrs | Lab B8.401 30 pax"
 * 
 * @param {string} rawSectionDate - The multiline raw section date string.
 * @returns {Array<{date: string, label: string, room: string}>} Array of valid slots.
 */
export function parseSectionDateSlots(rawSectionDate) {
  if (!rawSectionDate || typeof rawSectionDate !== "string") return [];
  
  const lines = rawSectionDate.split("\n");
  const slots = [];
  
  const monthMap = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"
  };

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Example: "19/Aug/2026 - Morning - 3 hrs | Lab B8.401 30 pax"
    const pipeParts = line.split("|");
    const roomRaw = pipeParts.length > 1 ? pipeParts[1].trim() : "N/A";
    
    const beforePipe = pipeParts[0].trim();
    const dashParts = beforePipe.split("-");
    const datePartRaw = dashParts[0].trim();
    const labelRaw = dashParts.slice(1).join("-").trim() || "N/A";

    // Parse DD/Mon/YYYY
    const dateParts = datePartRaw.split("/");
    if (dateParts.length === 3) {
      const dd = dateParts[0].padStart(2, "0");
      const monStr = dateParts[1].toLowerCase();
      const yyyy = dateParts[2];
      const mm = monthMap[monStr];

      if (mm && /^\d{4}$/.test(yyyy) && /^\d{2}$/.test(dd)) {
        slots.push({
          date: `${yyyy}-${mm}-${dd}`,
          label: labelRaw,
          room: roomRaw
        });
      } else {
        console.warn(`[ics-builder] Invalid date format in line: "${line}"`);
      }
    } else {
      console.warn(`[ics-builder] Could not parse date part in line: "${line}"`);
    }
  }

  return slots;
}

/**
 * Escapes special characters for iCalendar string fields (SUMMARY, DESCRIPTION, LOCATION, etc.)
 */
function escapeIcsText(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

/**
 * Folds a line at 75 octets (bytes) with CRLF + space, per RFC 5545.
 */
function foldLine(line) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  
  if (bytes.length <= 75) {
    return line + "\r\n";
  }

  let result = "";
  let currentLineBytes = 0;
  
  // We need to iterate by characters, not bytes, to avoid splitting multi-byte characters
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    
    if (currentLineBytes + charBytes > 75 && currentLineBytes > 0) {
      result += "\r\n ";
      currentLineBytes = 1; // 1 byte for the leading space
    }
    
    result += char;
    currentLineBytes += charBytes;
  }
  
  return result + "\r\n";
}

/**
 * Formats a Date object to UTC string for DTSTAMP: YYYYMMDDTHHmmssZ
 */
function formatUtcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Given a YYYY-MM-DD string, calculates the next day in YYYYMMDD format for DTEND.
 */
function getNextDay(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Builds a complete RFC 5545 compliant .ics string for one or more full-day events.
 * 
 * @param {Object} options 
 * @param {Array<{date: string, label: string, room: string}>} options.slots - Array of parsed slot objects
 * @param {string} options.courseName - Name of the course
 * @param {string} options.baseDescription - Formatted description block (without room info)
 * @param {string} options.venue - Venue name
 * @param {string} options.traineeEmail - Attendee email
 * @param {string} options.traineeName - Attendee full name
 * @param {string} options.sectionId - Base section ID
 */
export function buildIcs({ slots, courseName, baseDescription, venue, traineeEmail, traineeName, sectionId, method = "REQUEST", status = "CONFIRMED", sequence = 0, uidOffset = 0 }) {
  if (!slots || slots.length === 0) return "";

  const dtstamp = formatUtcStamp(new Date());
  
  let lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EIU Professional Development//PD OnestOp//EN",
    `METHOD:${method}`,
    "NAME:EIU PD Training"
  ];

  const totalDays = slots.length;

  for (let i = 0; i < totalDays; i++) {
    const slot = slots[i];
    const dateStr = slot.date; // YYYY-MM-DD
    const dtstart = dateStr.replace(/-/g, "");
    const dtend = getNextDay(dateStr);
    
    // Calculate the correct UID index (1-based, plus offset)
    const slotIndex = i + 1 + uidOffset;
    const uid = `${sectionId}-${slotIndex}-${traineeEmail}@pd-onestop.eiu.edu.vn`;
    
    let summary = `${courseName}`;
    if (totalDays > 1 || uidOffset > 0) {
      summary += ` (Day ${slotIndex} - ${slot.room})`;
    } else {
      summary += ` - ${slot.room}`;
    }

    const slotDescription = `Session: ${slot.label}\nRoom: ${slot.room}\n\n${baseDescription}`;
    const location = `${venue}${slot.room !== "N/A" ? ", " + slot.room : ""}`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
    lines.push(`DTEND;VALUE=DATE:${dtend}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(slotDescription)}`);
    lines.push(`LOCATION:${escapeIcsText(location)}`);
    lines.push("ORGANIZER;CN=EIU Professional Development:MAILTO:eoffice2@eiu.edu.vn");
    
    const attendeeLine = traineeName 
      ? `ATTENDEE;RSVP=FALSE;CN=${escapeIcsText(traineeName)}:MAILTO:${traineeEmail}`
      : `ATTENDEE;RSVP=FALSE:MAILTO:${traineeEmail}`;
      
    lines.push(attendeeLine);
    lines.push(`STATUS:${status}`);
    lines.push("TRANSP:TRANSPARENT");
    lines.push("CLASS:PUBLIC");
    lines.push(`SEQUENCE:${sequence}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // Fold all lines per RFC 5545
  return lines.map(line => foldLine(line)).join("");
}

/**
 * Builds the Base64 representation of the .ics content.
 */
export function buildIcsBase64(options) {
  const icsString = buildIcs(options);
  if (!icsString) return "";
  
  // Convert UTF-8 string to base64
  // We use TextEncoder + btoa for proper UTF-8 handling in JS
  const utf8Bytes = new TextEncoder().encode(icsString);
  const binaryString = String.fromCharCode(...utf8Bytes);
  return btoa(binaryString);
}
