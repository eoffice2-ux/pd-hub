function doPost(e) {
  try {
    const payloadStr = e.postData.contents;
    if (!payloadStr) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Missing payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(payloadStr);
    
    // 1. Validate Secret
    const expectedSecret = PropertiesService.getScriptProperties().getProperty("EMAIL_CENTER_SECRET");
    if (!expectedSecret || payload.secret !== expectedSecret) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Extract Fields
    const { to, subject, htmlBody, textBody, attachments } = payload;
    if (!to || !subject) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Missing 'to' or 'subject'" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Process Attachments
    const gasAttachments = [];
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (att.content && att.filename && att.mimeType) {
          const decoded = Utilities.base64Decode(att.content);
          const blob = Utilities.newBlob(decoded, att.mimeType, att.filename);
          gasAttachments.push(blob);
        }
      }
    }

    // 4. Send Email
    const options = {};
    if (htmlBody) options.htmlBody = htmlBody;
    if (gasAttachments.length > 0) options.attachments = gasAttachments;
    // Set name to match the organizer
    options.name = "EIU Professional Development";

    // GmailApp.sendEmail defaults to the executing user's email (eoffice2@eiu.edu.vn)
    GmailApp.sendEmail(to, subject, textBody || "Please view this email in an HTML-compatible client.", options);

    // 5. Return Success
    return ContentService.createTextOutput(JSON.stringify({ success: true, id: "gas-success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
