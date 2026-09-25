/**
 * Builds the HTML body for the registration confirmation email,
 * including the embedded Schema.org JSON-LD Event block.
 */
export function buildRegistrationEmailHtml(data) {
  const {
    traineeName,
    courseNameEn,
    courseNameVn,
    sectionNumber,
    sectionType,
    traineeType,
    sectionDateRaw,
    venue,
    bdIncharge,
    attendeeId,
    hasCalendarAttachment,
  } = data;

  const url = "https://pd-onestop.pages.dev/trainee";

  // Build JSON-LD (simplified without dates since we don't have start/end easily here anymore)
  let jsonLd = "";
  if (hasCalendarAttachment) {
    
    const schema = {
      "@context": "https://schema.org",
      "@type": "Event",
      "name": courseNameEn,
      "location": {
        "@type": "Place",
        "name": venue
      },
      "organizer": {
        "@type": "Organization",
        "name": "EIU Professional Development",
        "url": "https://pd-onestop.pages.dev"
      },
      "description": `Section ${sectionNumber} | BD In-charge: ${bdIncharge}`,
      "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
      "eventStatus": "https://schema.org/EventScheduled",
      "url": url
    };
    
    jsonLd = `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>\n`;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
    .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #ddd; }
    .content { padding: 20px; }
    .details { background-color: #f4f6f8; padding: 15px; border-radius: 6px; margin: 20px 0; }
    .detail-row { margin-bottom: 10px; }
    .label { font-weight: bold; width: 120px; display: inline-block; vertical-align: top; }
    .value { display: inline-block; width: calc(100% - 130px); }
    .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 0.9em; color: #666; border-top: 1px solid #ddd; }
  </style>
  ${jsonLd}
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>EIU Professional Development</h2>
      <a href="https://pd-onestop.pages.dev">pd-onestop.pages.dev</a>
    </div>
    
    <div class="content">
      <h3>&#127891; Registration Confirmed!</h3>
      <p>Dear <strong>${traineeName || 'Trainee'}</strong>,</p>
      <p>You have successfully registered for the following professional development course.</p>
      ${hasCalendarAttachment ? "<p>A calendar invitation is attached — open it to save the event to your calendar.</p>" : ""}
      
      <div class="details">
        <div class="detail-row"><span class="label">Course Name:</span><span class="value">${courseNameEn}<br>${courseNameVn}</span></div>
        <div class="detail-row"><span class="label">Section No.:</span><span class="value">${sectionNumber}</span></div>
        <div class="detail-row"><span class="label">Section Type:</span><span class="value">${sectionType}</span></div>
        <div class="detail-row"><span class="label">Trainee Type:</span><span class="value">${traineeType}</span></div>
        <div class="detail-row"><span class="label">&#128197; Schedule:</span><span class="value">${sectionDateRaw}</span></div>
        <div class="detail-row"><span class="label">&#128205; Venue:</span><span class="value">${venue}</span></div>
        <div class="detail-row"><span class="label">&#128100; BD In-charge:</span><span class="value">${bdIncharge}</span></div>
        <div class="detail-row"><span class="label">&#127903; Attendee ID:</span><span class="value">${attendeeId}</span></div>
      </div>
      
      ${hasCalendarAttachment ? `
      <h4>&#128206; Calendar Invitation Attached</h4>
      <p>A calendar file (event.ics) is attached to this email. Open it to automatically add this event to Google Calendar, Apple Calendar, or Outlook.</p>
      ` : ""}
      
      <p>➡ Or visit <a href="${url}">pd-onestop.pages.dev/trainee</a> to view your registration details.</p>
    </div>
    
    <div class="footer">
      This is an automated message from EIU PD OnestOp. Please do not reply to this email.<br>
      Questions? Contact: <a href="mailto:eoffice2@eiu.edu.vn">eoffice2@eiu.edu.vn</a>
    </div>
  </div>
</body>
</html>
  `.trim();

  return html;
}

/**
 * Builds the plain-text fallback body for the registration confirmation email.
 */
export function buildRegistrationEmailText(data) {
  const {
    traineeName,
    courseNameEn,
    courseNameVn,
    sectionNumber,
    sectionDateRaw,
    venue,
    bdIncharge,
    attendeeId,
    hasCalendarAttachment
  } = data;

  let text = `Registration Confirmed: ${courseNameEn} – Section ${sectionNumber}\n\n`;
  text += `Dear ${traineeName || 'Trainee'},\n\n`;
  text += `You have successfully registered for the following course:\n\n`;
  text += `  Course:       ${courseNameEn} / ${courseNameVn}\n`;
  text += `  Section No.:  ${sectionNumber}\n`;
  text += `  Schedule:     ${sectionDateRaw.replace(/<br>/g, ' ')}\n`;
  text += `  Venue:        ${venue}\n`;
  text += `  BD In-charge: ${bdIncharge}\n`;
  text += `  Attendee ID:  ${attendeeId}\n\n`;

  if (hasCalendarAttachment) {
    text += `A calendar file (event.ics) is attached. Open it to add this event to your calendar.\n\n`;
  }
  
  text += `Manage your registration: https://pd-onestop.pages.dev/trainee\n\n`;
  text += `---\nEIU Professional Development | eoffice2@eiu.edu.vn`;

  return text;
}
