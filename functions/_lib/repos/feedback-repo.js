import { psqlFindOne, psqlInsertRow, psqlSelectRows } from "../psql-adapter.js";
import { cleanEmail, nowVietnamLocal, parsePsqlVietnamDate } from "./repo-utils.js";
import { getRegistrationPsql } from "./registration-repo.js";

export async function listFeedbackFormsForSectionPsql(env, sectionId, options = {}) {
  return psqlSelectRows(env, "FB_SECTIONFORMS", {
    where: { "section id": String(sectionId || "").trim() },
    limit: options.limit || 100
  });
}

export async function getFeedbackFormPsql(env, formId) {
  return psqlFindOne(env, "FB_FORMS", { "form_id": String(formId || "").trim() });
}

export async function listFeedbackQuestionsPsql(env, formId, options = {}) {
  return psqlSelectRows(env, "FB_QUESTIONS", {
    where: { "form_id": String(formId || "").trim() },
    orderBy: options.orderBy || [{ column: "sort_order", direction: "ASC" }],
    limit: options.limit || 200
  });
}

export async function getFeedbackSubmissionPsql(env, formId, mappingId, email, options = {}) {
  return psqlFindOne(env, "FB_SUBMISSIONS", {
    "form_id": String(formId || "").trim(),
    "mapping_id": String(mappingId || "").trim(),
    "trainee_id": cleanEmail(email)
  }, options);
}

export async function insertFeedbackSubmissionPsql(env, formId, mappingId, email, data = {}, options = {}) {
  const clean = cleanEmail(email);
  const fid = String(formId || "").trim();
  const mid = String(mappingId || "").trim();
  const existing = await getFeedbackSubmissionPsql(env, fid, mid, clean, { bypassCache: true });
  if (existing) return { action: "existing", row: existing, rowCount: 0 };
  return psqlInsertRow(env, "FB_SUBMISSIONS", {
    "submission_id": data["submission_id"] || data["submission id"] || cryptoRandomId(),
    "form_id": fid,
    "mapping_id": mid,
    "trainee_id": clean,
    "submitted_at": data["submitted_at"] || data["submitted at"] || nowVietnamLocal()
  }, options);
}

export async function insertFeedbackResponsePsql(env, submissionId, questionId, answer, data = {}, options = {}) {
  return psqlInsertRow(env, "FB_RESPONSES", {
    "response_id": data["response_id"] || data["response id"] || cryptoRandomId(),
    "submission_id": String(submissionId || "").trim(),
    "question_id": String(questionId || "").trim(),
    "answer_value": answer ?? data["answer_value"] ?? data["answer"] ?? ""
  }, options);
}

function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("") || String(Date.now());
}

export async function getFormsForSectionPsql(env, email, sectionId) {
  const clean = cleanEmail(email);
  const safeSectionId = String(sectionId || "").trim();

  const registration = await getRegistrationPsql(env, clean, safeSectionId);
  if (!registration) {
    return { allowed: false, message: "Forbidden. Trainee is not registered for this section." };
  }

  const mappings = await listFeedbackFormsForSectionPsql(env, safeSectionId);
  if (mappings.length === 0) {
    return { allowed: true, count: 0, data: [] };
  }

  const data = [];
  const now = new Date();
  
  for (const m of mappings) {
    const formId = String(m["form_id"] || m["form id"] || "").trim();
    const mappingId = String(m["id"] || m["mapping_id"] || m["mapping id"] || "").trim();
    if (!formId || !mappingId) continue;

    const form = await getFeedbackFormPsql(env, formId);
    if (!form) continue;

    const submission = await getFeedbackSubmissionPsql(env, formId, mappingId, clean);
    const hasSubmitted = !!submission;

    const startVal = m["response starttime"] || m["response_starttime"];
    const endVal = m["response endtime"] || m["response_endtime"];
    const startTime = parsePsqlVietnamDate(startVal, "2000-01-01T00:00:00Z");
    const endTime = parsePsqlVietnamDate(endVal, "2099-12-31T23:59:59Z");

    let status = "Inactive";
    if (hasSubmitted) status = "Submitted";
    else if (now < startTime) status = "In-Active";
    else if (now > endTime) status = "Missed";
    else status = "Active";

    data.push({
      mappingId,
      formId,
      sectionId: safeSectionId,
      title: m["form_title"] || m["form title"] || form["title"] || "",
      description: form["description"] || "",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status
    });
  }

  return { allowed: true, count: data.length, data };
}

export async function submitFeedbackFormPsql(env, email, formId, mappingId, answersArray = [], dryRun = true) {
  const clean = cleanEmail(email);
  const safeFormId = String(formId || "").trim();
  const safeMappingId = String(mappingId || "").trim();

  const mappings = await psqlSelectRows(env, "FB_SECTIONFORMS", {
    where: { "form_id": safeFormId, "id": safeMappingId }
  });
  const mappingRow = mappings[0];
  if (!mappingRow) {
    return { status: "Mapping Not Found", message: "Feedback mapping was not found.", formId: safeFormId, mappingId: safeMappingId, submitted: false };
  }
  const sectionId = String(mappingRow["section id"] || mappingRow["section_id"] || "").trim();

  const registration = await getRegistrationPsql(env, clean, sectionId, { bypassCache: true });
  if (!registration) {
    return { status: "Forbidden", message: "Trainee is not registered for this form's section.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false };
  }

  const form = await getFeedbackFormPsql(env, safeFormId);
  if (!form) {
    return { status: "Form Not Found", message: "Feedback form was not found.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false };
  }
  
  const startVal = mappingRow["response starttime"] || mappingRow["response_starttime"];
  const endVal = mappingRow["response endtime"] || mappingRow["response_endtime"];
  const startTime = parsePsqlVietnamDate(startVal, "2000-01-01T00:00:00Z");
  const endTime = parsePsqlVietnamDate(endVal, "2099-12-31T23:59:59Z");
  const now = new Date();
  const isOpen = now >= startTime && now <= endTime;
  
  const timeWindow = {
    enforced: true,
    isOpen,
    now: now.toISOString(),
    validFrom: startTime.toISOString(),
    validTo: endTime.toISOString(),
    startValue: String(startVal || ""),
    endValue: String(endVal || "")
  };
  if (!isOpen) {
    const status = now < startTime ? "In-Active" : "Missed";
    return { status, message: `Feedback submission is only allowed from ${timeWindow.validFrom} to ${timeWindow.validTo}.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false, timeWindow };
  }

  const duplicate = await getFeedbackSubmissionPsql(env, safeFormId, safeMappingId, clean, { bypassCache: true });
  if (duplicate) {
    return { status: "Already Submitted", message: "You have already submitted this feedback form.", sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: true, duplicate: true };
  }

  const questions = await listFeedbackQuestionsPsql(env, safeFormId);
  const validQuestionIds = new Set(questions.map(q => String(q["question_id"] || q["question id"] || "").trim()).filter(Boolean));
  const answerMap = new Map();
  for (const ans of answersArray) {
    const qid = String(ans?.questionId || ans?.question_id || "").trim();
    if (!qid) continue;
    if (!validQuestionIds.has(qid)) {
      return { status: "Invalid Question", message: `Question ${qid} does not belong to this form.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false };
    }
    answerMap.set(qid, ans?.answer ?? ans?.answer_value ?? "");
  }
  for (const q of questions) {
    const qid = String(q["question_id"] || q["question id"] || "").trim();
    const required = q["is_required"] === true || q["isrequired"] === true || q["required"] === true;
    if (required && (!answerMap.has(qid) || String(answerMap.get(qid) ?? "").trim() === "")) {
      return { status: "Missing Required Answer", message: `Missing required answer for question ${qid}.`, sectionId, formId: safeFormId, mappingId: safeMappingId, submitted: false };
    }
  }

  const submissionId = `SUB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!dryRun) {
    await insertFeedbackSubmissionPsql(env, safeFormId, safeMappingId, clean, {
      "submission_id": submissionId,
      "submitted_at": nowVietnamLocal(),
      "section id": sectionId
    });
    
    let counter = 1;
    for (const [questionId, answer] of answerMap.entries()) {
      const responseId = `${submissionId}-R${counter++}`;
      await insertFeedbackResponsePsql(env, submissionId, questionId, answer, {
        "response_id": responseId
      });
    }
  }

  return {
    status: "Success",
    message: dryRun ? "Dry run OK. No feedback rows were appended." : "Feedback submitted successfully.",
    sectionId,
    formId: safeFormId,
    mappingId: safeMappingId,
    submissionId,
    traineeEmail: clean,
    submitted: !dryRun,
    dryRun,
    timeWindow,
    questionCount: questions.length,
    answerCount: answerMap.size
  };
}

export async function getFeedbackQuestionsPsql(env, email, formId, mappingId) {
  const clean = cleanEmail(email);
  const safeFormId = String(formId || "").trim();
  const safeMappingId = String(mappingId || "").trim();

  const mappings = await psqlSelectRows(env, "FB_SECTIONFORMS", {
    where: { "form_id": safeFormId, "id": safeMappingId }
  });
  const mappingRow = mappings[0];
  if (!mappingRow) {
    return { allowed: false, message: "Feedback mapping was not found." };
  }
  const sectionId = String(mappingRow["section id"] || mappingRow["section_id"] || "").trim();

  const registration = await getRegistrationPsql(env, clean, sectionId);
  if (!registration) {
    return { allowed: false, message: "Forbidden. Trainee is not registered for this section." };
  }

  const questions = await listFeedbackQuestionsPsql(env, safeFormId);
  
  const data = questions.map(q => ({
    questionId: String(q["question_id"] || q["question id"] || ""),
    text: String(q["question_text"] || q["text"] || q["question text"] || ""),
    type: String(q["question_type"] || q["type"] || "text"),
    options: String(q["options"] || ""),
    isRequired: q["is_required"] === true || q["isrequired"] === true || q["required"] === true,
    sortOrder: Number(q["sort_order"] || q["sort order"] || 0)
  }));

  return { allowed: true, count: data.length, data };
}
