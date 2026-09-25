import { jsonResponse } from "../../../_lib/security.js";
import { parseSectionDateSlots, buildIcsBase64 } from "../../../_lib/ics-builder.js";
import { buildUpdateEmailHtml, buildUpdateEmailText } from "../../../_lib/webhook-email.js";
import { listActiveRegistrationsForSectionPsql } from "../../../_lib/repos/registration-repo.js";
import { sendEmail } from "../../../_lib/email-sender.js";

export async function onRequestPost(context) {
  const env = context.env || {};
  const request = context.request;

  // 1. Authenticate AppSheet Webhook
  const secret = request.headers.get("x-appsheet-secret");
  if (!secret || secret !== env.APPSHEET_WEBHOOK_SECRET) {
    return jsonResponse({ success: false, error: "Unauthorized webhook" }, 401);
  }

  // 2. Parse payload
  let data;
  try {
    data = await request.json();
  } catch (err) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }

  const { sectionId, courseNameEn, oldSectionDate, newSectionDate, venue } = data;
  if (!sectionId || !newSectionDate) {
    return jsonResponse({ success: false, error: "Missing required fields" }, 400);
  }

  // 3. Fetch Active Trainees (Mass vs Individual)
  let trainees = [];
  if (data.traineeEmail) {
    // Individual update
    trainees = [{ 
      "trainee id": data.traineeEmail, 
      "trainee name": data.traineeName || data.traineeEmail.split('@')[0] 
    }];
  } else {
    // Mass update
    try {
      trainees = await listActiveRegistrationsForSectionPsql(env, sectionId);
    } catch (err) {
      return jsonResponse({ success: false, error: "Failed to fetch trainees: " + err.message }, 500);
    }
  }

  if (trainees.length === 0) {
    return jsonResponse({ success: true, message: "No active trainees found. Skipped emails." }, 200);
  }

  // 4. Determine Slots and Shrinking
  const oldSlots = parseSectionDateSlots(oldSectionDate || "");
  const newSlots = parseSectionDateSlots(newSectionDate);
  const sequence = Math.floor(Date.now() / 1000);

  // If the schedule shrank, we need to cancel the orphaned slots (the ones at the end)
  let cancelledSlots = [];
  if (oldSlots.length > newSlots.length) {
    // Keep the slots that are being dropped
    cancelledSlots = oldSlots.slice(newSlots.length);
  }

  let successCount = 0;
  let failureCount = 0;

  // 5. Dispatch Emails Batch via unified sender (GAS1 -> GAS2 -> Brevo -> Resend)
  // We use Promise.all to send them in parallel, but catch individual errors safely.
  const emailPromises = trainees.map(async (t) => {
    const traineeEmail = (t["trainee id"] || "").trim();
    if (!traineeEmail) return;

    const traineeName = (t["trainee name"] || traineeEmail.split('@')[0]).trim();
    const attendeeId = `${sectionId}-${traineeEmail}`;

    const baseDescription = `Course: ${courseNameEn}\nSection No.: ${sectionId}\nAttendee ID: ${attendeeId}\n\nThis schedule has been updated via AppSheet.`;

    const attachments = [];

    // Attachment 1: Update existing slots
    if (newSlots.length > 0) {
      const updateIcs = buildIcsBase64({
        slots: newSlots,
        courseName: courseNameEn,
        baseDescription,
        venue: venue || "N/A",
        traineeEmail,
        traineeName,
        sectionId,
        method: "REQUEST",
        status: "CONFIRMED",
        sequence
      });
      if (updateIcs) {
        attachments.push({
          filename: "schedule-update.ics",
          content: updateIcs,
          mimeType: "text/calendar; method=REQUEST; charset=UTF-8"
        });
      }
    }

    // Attachment 2: Cancel orphaned slots (if any)
    if (cancelledSlots.length > 0) {
      const cancelIcs = buildIcsBase64({
        slots: cancelledSlots,
        courseName: courseNameEn,
        baseDescription,
        venue: venue || "N/A",
        traineeEmail,
        traineeName,
        sectionId,
        method: "CANCEL",
        status: "CANCELLED",
        sequence,
        uidOffset: newSlots.length
      });
      if (cancelIcs) {
        attachments.push({
          filename: "schedule-cancellation.ics",
          content: cancelIcs,
          mimeType: "text/calendar; method=CANCEL; charset=UTF-8"
        });
      }
    }

    const htmlBody = buildUpdateEmailHtml({
      traineeName,
      courseNameEn,
      sectionId,
      oldSectionDateRaw: (oldSectionDate || "").replace(/\n/g, "<br>"),
      newSectionDateRaw: newSectionDate.replace(/\n/g, "<br>"),
      venue: venue || "N/A"
    });

    const textBody = buildUpdateEmailText({
      traineeName,
      courseNameEn,
      sectionId,
      oldSectionDateRaw: oldSectionDate || "",
      newSectionDateRaw: newSectionDate,
      venue: venue || "N/A"
    });

    try {
      await sendEmail(env, {
        to: traineeEmail,
        subject: `Schedule Update: ${courseNameEn} – Section ${sectionId}`,
        html: htmlBody,
        text: textBody,
        attachments,
        logContext: `UpdateSchedule-${sectionId}`
      });
      successCount++;
    } catch (e) {
      console.error(`[UpdateSchedule] Email to ${traineeEmail} failed:`, e.message);
      failureCount++;
    }
  });

  await Promise.all(emailPromises);

  return jsonResponse({
    success: true,
    message: `Batch complete. Success: ${successCount}, Failures: ${failureCount}`,
    traineeCount: trainees.length
  }, 200);
}
