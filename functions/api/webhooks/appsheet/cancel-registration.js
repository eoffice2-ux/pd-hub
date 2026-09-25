import { jsonResponse } from "../../../_lib/security.js";
import { parseSectionDateSlots, buildIcsBase64 } from "../../../_lib/ics-builder.js";
import { buildCancellationEmailHtml, buildCancellationEmailText } from "../../../_lib/webhook-email.js";
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

  const { traineeEmail, sectionId, courseNameEn, sectionDate } = data;
  if (!traineeEmail || !sectionId || !sectionDate) {
    return jsonResponse({ success: false, error: "Missing required fields" }, 400);
  }

  // 3. Generate Cancellation ICS
  const slots = parseSectionDateSlots(sectionDate);
  if (slots.length === 0) {
    return jsonResponse({ success: true, message: "No calendar dates found. Skipped cancellation." }, 200);
  }

  // Same dynamic sequence logic
  const sequence = Math.floor(Date.now() / 1000);
  const traineeName = traineeEmail.split('@')[0]; // simple fallback

  const baseDescription = `Course: ${courseNameEn}\nSection No.: ${sectionId}\nAttendee ID: ${sectionId}-${traineeEmail}\n\nThis registration has been cancelled.`;

  const icsBase64 = buildIcsBase64({
    slots,
    courseName: courseNameEn,
    baseDescription,
    venue: "N/A", // Venue not strictly needed for cancellation display
    traineeEmail,
    traineeName,
    sectionId,
    method: "CANCEL",
    status: "CANCELLED",
    sequence
  });

  // 4. Generate Email
  const htmlBody = buildCancellationEmailHtml({
    traineeName,
    courseNameEn,
    sectionId,
    sectionDateRaw: sectionDate.replace(/\n/g, "<br>")
  });
  
  const textBody = buildCancellationEmailText({
    traineeName,
    courseNameEn,
    sectionId,
    sectionDateRaw: sectionDate
  });

  // 5. Send Email via unified sender (GAS1 -> GAS2 -> Brevo -> Resend)
  try {
    const result = await sendEmail(env, {
      to: traineeEmail,
      subject: `Registration Cancelled: ${courseNameEn} – Section ${sectionId}`,
      html: htmlBody,
      text: textBody,
      attachments: [
        {
          filename: "schedule-cancellation.ics",
          content: icsBase64,
          mimeType: "text/calendar; method=CANCEL; charset=UTF-8"
        }
      ],
      logContext: "Cancellation"
    });
    return jsonResponse({ success: true, message: `Cancellation email sent via ${result.provider}` }, 200);
  } catch (err) {
    console.error("[Cancel] Email delivery failed:", err.message);
    return jsonResponse({ success: true, warning: `Cancellation processed, but email failed: ${err.message}` }, 200);
  }
}
