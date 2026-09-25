export function buildCancellationEmailHtml(data) {
  const { traineeName, courseNameEn, sectionId, sectionDateRaw } = data;
  const url = "https://pd-onestop.pages.dev/trainee";

  return `
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
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>EIU Professional Development</h2>
      <a href="https://pd-onestop.pages.dev">pd-onestop.pages.dev</a>
    </div>
    <div class="content">
      <h3>&#128683; Registration Cancelled</h3>
      <p>Dear <strong>${traineeName || 'Trainee'}</strong>,</p>
      <p>Your registration for the following course has been cancelled.</p>
      <div class="details">
        <div class="detail-row"><span class="label">Course Name:</span><span class="value">${courseNameEn}</span></div>
        <div class="detail-row"><span class="label">Section ID:</span><span class="value">${sectionId}</span></div>
        <div class="detail-row"><span class="label">&#128197; Schedule:</span><span class="value">${sectionDateRaw}</span></div>
      </div>
      <h4>&#128206; Calendar Cancellation Attached</h4>
      <p>A calendar cancellation file is attached to this email. Opening it should automatically remove the event from your calendar.</p>
    </div>
    <div class="footer">
      This is an automated message from EIU PD OnestOp. Please do not reply to this email.<br>
      Questions? Contact: <a href="mailto:eoffice2@eiu.edu.vn">eoffice2@eiu.edu.vn</a>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildCancellationEmailText(data) {
  const { traineeName, courseNameEn, sectionId, sectionDateRaw } = data;
  return `Registration Cancelled: ${courseNameEn} – Section ${sectionId}\n\nDear ${traineeName || 'Trainee'},\n\nYour registration for the following course has been cancelled:\n\n  Course:       ${courseNameEn}\n  Section ID:   ${sectionId}\n  Schedule:     ${sectionDateRaw.replace(/<br>/g, ' ')}\n\nA calendar cancellation file is attached. Opening it should automatically remove the event from your calendar.\n\n---\nEIU Professional Development | eoffice2@eiu.edu.vn`;
}

export function buildUpdateEmailHtml(data) {
  const { traineeName, courseNameEn, sectionId, oldSectionDateRaw, newSectionDateRaw, venue } = data;
  const url = "https://pd-onestop.pages.dev/trainee";

  return `
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
    .label { font-weight: bold; width: 130px; display: inline-block; vertical-align: top; }
    .value { display: inline-block; width: calc(100% - 140px); }
    .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 0.9em; color: #666; border-top: 1px solid #ddd; }
    .old-date { text-decoration: line-through; color: #888; }
    .new-date { color: #d32f2f; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>EIU Professional Development</h2>
      <a href="https://pd-onestop.pages.dev">pd-onestop.pages.dev</a>
    </div>
    <div class="content">
      <h3>&#128197; Schedule Update</h3>
      <p>Dear <strong>${traineeName || 'Trainee'}</strong>,</p>
      <p>The schedule for your registered course has been updated.</p>
      <div class="details">
        <div class="detail-row"><span class="label">Course Name:</span><span class="value">${courseNameEn}</span></div>
        <div class="detail-row"><span class="label">Section ID:</span><span class="value">${sectionId}</span></div>
        <div class="detail-row"><span class="label">Old Schedule:</span><span class="value old-date">${oldSectionDateRaw}</span></div>
        <div class="detail-row"><span class="label">New Schedule:</span><span class="value new-date">${newSectionDateRaw}</span></div>
        <div class="detail-row"><span class="label">&#128205; Venue:</span><span class="value">${venue}</span></div>
      </div>
      <h4>&#128206; Calendar Update Attached</h4>
      <p>A calendar update file is attached to this email. Opening it will update the event times on your calendar.</p>
      <p>➡ Visit <a href="${url}">pd-onestop.pages.dev/trainee</a> to view your full registration details.</p>
    </div>
    <div class="footer">
      This is an automated message from EIU PD OnestOp. Please do not reply to this email.<br>
      Questions? Contact: <a href="mailto:eoffice2@eiu.edu.vn">eoffice2@eiu.edu.vn</a>
    </div>
  </div>
</body>
</html>`.trim();
}

export function buildUpdateEmailText(data) {
  const { traineeName, courseNameEn, sectionId, oldSectionDateRaw, newSectionDateRaw, venue } = data;
  return `Schedule Update: ${courseNameEn} – Section ${sectionId}\n\nDear ${traineeName || 'Trainee'},\n\nThe schedule for your registered course has been updated:\n\n  Course:       ${courseNameEn}\n  Section ID:   ${sectionId}\n  Old Schedule: ${oldSectionDateRaw.replace(/<br>/g, ' ')}\n  New Schedule: ${newSectionDateRaw.replace(/<br>/g, ' ')}\n  Venue:        ${venue}\n\nA calendar update file is attached. Opening it will update the event times on your calendar.\n\nManage your registration: https://pd-onestop.pages.dev/trainee\n\n---\nEIU Professional Development | eoffice2@eiu.edu.vn`;
}
