import { getSectionDetailsPsql } from "./repos/section-repo.js";
import { getTraineeProfilePsql } from "./repos/trainee-profile-repo.js";
import { parseSectionDateSlots, buildIcsBase64 } from "./ics-builder.js";
import { buildRegistrationEmailHtml, buildRegistrationEmailText } from "./registration-email.js";
import { sendEmail } from "./email-sender.js";

/**
 * Orchestrates sending a registration confirmation email with calendar attachment
 * via the GAS Email Center. This should be run in a context.waitUntil() block.
 * 
 * @param {Object} env - Cloudflare env object
 * @param {Object} params
 * @param {string} params.traineeEmail - The email of the trainee
 * @param {string} params.sectionId - The ID of the section registered
 * @param {Object} [params.sectionRow] - Optional section row to avoid refetching
 */
export async function sendRegistrationConfirmation(env, { traineeEmail, sectionId, sectionRow }) {
  try {
    // 1. Fetch section details if not provided fully
    const details = await getSectionDetailsPsql(env, sectionId);
    if (!details || !details.section) {
      console.error(`[Mailer] Section ${sectionId} not found`);
      return;
    }
    
    // Merge if we passed the row directly from the registration process. 
    // Ignore if it's an Array (GSheet raw row).
    const section = (sectionRow && !Array.isArray(sectionRow)) ? sectionRow : details.section;
    const course = details.course || {};
    const venue = details.venue || {};

    // 2. Check early exit condition for calendar dates
    const rawSectionDate = section["section date"] || "";
    const slots = parseSectionDateSlots(rawSectionDate);
    
    if (slots.length === 0) {
      // Per plan: "Email is skipped entirely if section date yields zero valid slots"
      console.log(`[Mailer] Skipped email for ${traineeEmail} - section ${sectionId} has no parseable date slots.`);
      return;
    }

    // 3. Fetch Trainee Profile
    const profile = await getTraineeProfilePsql(env, traineeEmail);
    const traineeName = profile ? (profile["full name"] || profile["Full Name"] || traineeEmail) : traineeEmail;
    
    // 4. Extract necessary fields
    const courseNameEn = course["course name en"] || course["course name"] || course["course id"] || section["course id"] || "Course";
    const courseNameVn = course["course name vn"] || course["course name"] || "";
    const sectionNumber = section["section number"] || sectionId;
    const sectionDateRaw = String(section["section date"] || section["date"] || "N/A").replace(/\n/g, "<br>");
    const venueName = venue["venue name"] || venue["name"] || section["section venue"] || section["venue"] || "N/A";
    const roomTitle = venue["room title"] || venue["room"] || section["section room id"] || section["room id"] || "N/A";
    const bdIncharge = section["bd incharge id"] || section["bd_incharge"] || "N/A";
    const sectionType = section["section type"] || section["section_type"] || "N/A";
    const traineeType = section["section trainee type"] || "N/A";
    const attendeeId = `${sectionId}-${traineeEmail}`; // Reconstruct Attendee ID format

    // 5. Build base description for ICS (without room, room is added per slot)
    const baseDescription = `Course: ${courseNameEn}\n(${courseNameVn})\n\n` +
      `Section No.: ${sectionNumber}\n` +
      `Venue: ${venueName}\n` +
      `BD In-charge: ${bdIncharge}\n\n` +
      `Attendee ID: ${attendeeId}\n\n` +
      `Manage registration:\nhttps://pd-onestop.pages.dev/trainee`;

    // 6. Build ICS Base64 Payload
    const icsBase64 = buildIcsBase64({
      slots,
      courseName: courseNameEn,
      baseDescription,
      venue: venueName,
      traineeEmail,
      traineeName,
      sectionId
    });

    // 7. Build Email Content
    const data = {
      traineeName,
      courseNameEn,
      courseNameVn,
      sectionNumber,
      sectionType,
      traineeType,
      sectionDateRaw,
      venue: venueName,
      bdIncharge,
      attendeeId,
      hasCalendarAttachment: slots.length > 0
    };
    
    const htmlBody = buildRegistrationEmailHtml(data);
    const textBody = buildRegistrationEmailText(data);
    const subject = `Registration Confirmed: ${courseNameEn} – Section ${sectionNumber}`;

    // 8. Send Confirmation Email via unified sender (GAS1 -> GAS2 -> Brevo -> Resend)
    try {
      await sendEmail(env, {
        to: traineeEmail,
        subject,
        html: htmlBody,
        text: textBody,
        attachments: [
          {
            filename: "event.ics",
            content: icsBase64,
            mimeType: "text/calendar"
          }
        ],
        logContext: "Registration Confirm"
      });
    } catch (sendErr) {
      console.error(`[Mailer] All email providers failed for ${traineeEmail}:`, sendErr.message);
    }
  } catch (err) {
    console.error("[Mailer] Unhandled error:", err);
  }
}
