import { jsonResponse, requireAdminOrDebug, requireAdminSession, isAdminEmail, normalizeEmail } from "../../_lib/security.js";
import { getCoreSpreadsheetId, getFeedbackSpreadsheetId, getSheetValues, quoteSheetName } from "../../_lib/google-sheets.js";
import { getTableSource, getTableSheetName, getTablePsqlName, quoteIdentifierPath } from "../../_lib/data-source.js";
import { queryPostgres } from "../../_lib/postgres.js";
import { getUserRole } from "../../_lib/user-roles.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const request = context.request;

  // Authorization: debug token, ADMIN_EMAILS, role=admin, or role=report_viewer
  const debugAuth = await requireAdminOrDebug(request, env);
  if (!debugAuth.ok) {
    const sessionAuth = await requireAdminSession(request, env);
    if (!sessionAuth.ok) return sessionAuth.response;
    const role = await getUserRole(env, sessionAuth.session.email);
    const isEnvAdmin = isAdminEmail(sessionAuth.session.email, env);
    if (!isEnvAdmin && role !== "admin" && role !== "report_viewer") {
      return jsonResponse({ success: false, error: "Forbidden. Requires admin or report_viewer role." }, 403);
    }
  }

  const url = new URL(request.url);
  const sectionId = String(url.searchParams.get("sectionId") || "").trim();
  if (!sectionId) {
    return jsonResponse({ success: false, error: "Missing sectionId parameter." }, 400);
  }

  try {
    const coreSpreadsheetId = getCoreSpreadsheetId(env);
    const feedbackSpreadsheetId = getFeedbackSpreadsheetId(env);

    // 1. Fetch section form mappings
    const sfRes = await fetchTableAsMatrix(env, "FB_SECTIONFORMS", feedbackSpreadsheetId);
    const sfValues = sfRes.values || [];
    if (sfValues.length < 2) {
      return jsonResponse({ success: true, data: { sectionId, rounds: [] } });
    }

    const sfHeaders = sfValues[0].map(normalizeHeader);
    const sfSecIdIdx = getHeaderIndex(sfHeaders, ["section id", "section_id"]);
    const sfMappingIdIdx = getHeaderIndex(sfHeaders, ["mapping id", "mapping_id", "id"]);
    const sfFormIdIdx = getHeaderIndex(sfHeaders, ["form id", "form_id"]);
    const sfFormTitleIdx = getHeaderIndex(sfHeaders, ["form title", "form_title", "title"]);

    if (sfSecIdIdx === -1 || sfMappingIdIdx === -1) {
      return jsonResponse({ success: true, data: { sectionId, rounds: [] } });
    }

    // Filter mappings for this section
    const targetMappings = [];
    for (let i = 1; i < sfValues.length; i++) {
      const row = sfValues[i];
      const sid = String(row[sfSecIdIdx] || "").trim();
      if (sid.toLowerCase() === sectionId.toLowerCase()) {
        const mid = String(row[sfMappingIdIdx] || "").trim();
        const fid = sfFormIdIdx !== -1 ? String(row[sfFormIdIdx] || "").trim() : "";
        const title = sfFormTitleIdx !== -1 ? String(row[sfFormTitleIdx] || "").trim() : "Khảo sát";
        if (mid) {
          targetMappings.push({ mappingId: mid, formId: fid, formTitle: title || "Khảo sát" });
        }
      }
    }

    if (targetMappings.length === 0) {
      return jsonResponse({ success: true, data: { sectionId, rounds: [] } });
    }

    // 2. Fetch questions, submissions, responses, and trainee profiles in parallel
    const [questionsRes, submissionsRes, responsesRes, traineeRes] = await Promise.all([
      fetchTableAsMatrix(env, "FB_QUESTIONS", feedbackSpreadsheetId),
      fetchTableAsMatrix(env, "FB_SUBMISSIONS", feedbackSpreadsheetId),
      fetchTableAsMatrix(env, "FB_RESPONSES", feedbackSpreadsheetId),
      fetchTableAsMatrix(env, "TRAINEE_PROFILE", coreSpreadsheetId)
    ]);

    // Build trainee id -> email map
    const traineeEmailMap = {};
    const trValues = traineeRes.values || [];
    if (trValues.length > 1) {
      const trHeaders = trValues[0].map(normalizeHeader);
      const trEmailIdx = getHeaderIndex(trHeaders, ["trainee email", "trainee_email", "email"]);
      const trIdIdx = getHeaderIndex(trHeaders, ["trainee id", "trainee_id", "id"]);
      for (let i = 1; i < trValues.length; i++) {
        const row = trValues[i];
        const email = trEmailIdx !== -1 ? normalizeEmail(row[trEmailIdx]) : "";
        const tid = trIdIdx !== -1 ? normalizeEmail(row[trIdIdx]) : "";
        if (email) {
          if (tid) traineeEmailMap[tid] = email;
          traineeEmailMap[email] = email;
        }
      }
    }

    // Parse questions: formId -> array of questions
    const questionsByForm = {};
    const qValues = questionsRes.values || [];
    if (qValues.length > 1) {
      const qHeaders = qValues[0].map(normalizeHeader);
      const qFormIdIdx = getHeaderIndex(qHeaders, ["form id", "form_id"]);
      const qIdIdx = getHeaderIndex(qHeaders, ["question id", "question_id", "id"]);
      const qTextIdx = getHeaderIndex(qHeaders, ["question text", "question_text", "text"]);
      const qTypeIdx = getHeaderIndex(qHeaders, ["question type", "question_type", "type"]);
      const qOptionsIdx = getHeaderIndex(qHeaders, ["options"]);
      const qSortIdx = getHeaderIndex(qHeaders, ["sort order", "sort_order"]);

      for (let i = 1; i < qValues.length; i++) {
        const row = qValues[i];
        const fid = qFormIdIdx !== -1 ? String(row[qFormIdIdx] || "").trim() : "";
        const qid = qIdIdx !== -1 ? String(row[qIdIdx] || "").trim() : "";
        if (!fid || !qid) continue;

        if (!questionsByForm[fid]) questionsByForm[fid] = [];
        questionsByForm[fid].push({
          questionId: qid,
          text: qTextIdx !== -1 ? String(row[qTextIdx] || "").trim() : qid,
          type: qTypeIdx !== -1 ? String(row[qTypeIdx] || "text").trim().toLowerCase() : "text",
          options: qOptionsIdx !== -1 ? String(row[qOptionsIdx] || "").trim() : "",
          sortOrder: qSortIdx !== -1 ? Number(row[qSortIdx] || 0) : 0
        });
      }

      for (const fid in questionsByForm) {
        questionsByForm[fid].sort((a, b) => a.sortOrder - b.sortOrder);
      }
    }

    // Parse submissions: mappingId -> array of { submissionId, traineeEmail }
    const submissionsByMapping = {};
    const submissionIdToEmail = {};
    const subValues = submissionsRes.values || [];
    if (subValues.length > 1) {
      const subHeaders = subValues[0].map(normalizeHeader);
      const subIdIdx = getHeaderIndex(subHeaders, ["submission id", "submission_id", "id"]);
      const subMapIdx = getHeaderIndex(subHeaders, ["mapping id", "mapping_id"]);
      const subTraineeIdx = getHeaderIndex(subHeaders, ["trainee id", "trainee_id", "trainee email", "user email", "user_email"]);
      const subTimeIdx = getHeaderIndex(subHeaders, ["submitted at", "submitted_at", "timestamp", "created at"]);

      for (let i = 1; i < subValues.length; i++) {
        const row = subValues[i];
        const subId = subIdIdx !== -1 ? String(row[subIdIdx] || "").trim() : "";
        const mid = subMapIdx !== -1 ? String(row[subMapIdx] || "").trim() : "";
        const rawTrainee = subTraineeIdx !== -1 ? String(row[subTraineeIdx] || "").trim() : "";
        const cleanTrainee = normalizeEmail(rawTrainee);
        const resolvedEmail = traineeEmailMap[cleanTrainee] || cleanTrainee || rawTrainee;
        const submittedAt = subTimeIdx !== -1 ? String(row[subTimeIdx] || "").trim() : "";

        if (subId && mid) {
          if (!submissionsByMapping[mid]) submissionsByMapping[mid] = [];
          submissionsByMapping[mid].push({ submissionId: subId, email: resolvedEmail, submittedAt });
          submissionIdToEmail[subId] = { email: resolvedEmail, submittedAt };
        }
      }
    }

    // Parse responses: submissionId -> questionId -> answer_value
    const responsesBySubmission = {};
    const respValues = responsesRes.values || [];
    if (respValues.length > 1) {
      const respHeaders = respValues[0].map(normalizeHeader);
      const respSubIdIdx = getHeaderIndex(respHeaders, ["submission id", "submission_id"]);
      const respQIdIdx = getHeaderIndex(respHeaders, ["question id", "question_id"]);
      const respAnsIdx = getHeaderIndex(respHeaders, ["answer_value", "answer value", "answer"]);

      for (let i = 1; i < respValues.length; i++) {
        const row = respValues[i];
        const subId = respSubIdIdx !== -1 ? String(row[respSubIdIdx] || "").trim() : "";
        const qid = respQIdIdx !== -1 ? String(row[respQIdIdx] || "").trim() : "";
        const val = respAnsIdx !== -1 ? row[respAnsIdx] : "";
        if (!subId || !qid) continue;

        if (!responsesBySubmission[subId]) responsesBySubmission[subId] = {};
        responsesBySubmission[subId][qid] = val;
      }
    }

    // 3. Assemble survey rounds with aggregated questions
    const rounds = targetMappings.map((m) => {
      const mappingSubs = submissionsByMapping[m.mappingId] || [];
      const formQuestions = questionsByForm[m.formId] || [];

      const questions = formQuestions.map((q) => {
        const isRating = q.type === "rating";
        const isChoice = q.type === "choice" || q.type === "select" || q.type === "radio";
        
        let answeredCount = 0;
        let ratingSum = 0;
        let ratingCount = 0;
        const distribution = {};
        const texts = [];

        // Pre-populate distribution for predefined options if present
        if (isRating) {
          const ratingOpts = q.options ? parseOptionsList(q.options) : ["1", "2", "3", "4", "5"];
          ratingOpts.forEach(opt => distribution[opt] = 0);
        } else if (isChoice && q.options) {
          const choiceOpts = parseOptionsList(q.options);
          choiceOpts.forEach(opt => distribution[opt] = 0);
        }

        for (const sub of mappingSubs) {
          const subAnswers = responsesBySubmission[sub.submissionId] || {};
          const rawAns = subAnswers[q.questionId];
          if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;

          answeredCount++;
          const ansStr = String(rawAns).trim();

          if (isRating) {
            const num = parseFloat(ansStr);
            if (Number.isFinite(num)) {
              ratingSum += num;
              ratingCount++;
            }
            const key = ansStr;
            distribution[key] = (distribution[key] || 0) + 1;
          } else if (isChoice) {
            distribution[ansStr] = (distribution[ansStr] || 0) + 1;
          } else {
            // Text or fallback
            texts.push({
              text: ansStr,
              email: sub.email || "",
              submittedAt: sub.submittedAt || ""
            });
          }
        }

        // Sort text quotes by submittedAt descending
        texts.sort((a, b) => Date.parse(b.submittedAt || 0) - Date.parse(a.submittedAt || 0));

        const qResult = {
          questionId: q.questionId,
          text: q.text,
          type: isRating ? "rating" : isChoice ? "choice" : "text",
          options: q.options,
          answered: answeredCount
        };

        if (isRating) {
          qResult.average = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0;
          qResult.distribution = distribution;
        } else if (isChoice) {
          qResult.distribution = distribution;
        } else {
          qResult.texts = texts;
        }

        return qResult;
      });

      return {
        mappingId: m.mappingId,
        formId: m.formId,
        formTitle: m.formTitle,
        submittedCount: mappingSubs.length,
        questions
      };
    });

    return jsonResponse({
      success: true,
      data: {
        sectionId,
        rounds
      }
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || String(err) }, 500);
  }
}

function parseOptionsList(optionsStr) {
  if (!optionsStr) return [];
  return String(optionsStr)
    .split(/[\r\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

function getHeaderIndex(headers, keys) {
  for (const key of keys) {
    const idx = headers.indexOf(key);
    if (idx !== -1) return idx;
  }
  return -1;
}

async function fetchTableAsMatrix(env, tableKey, spreadsheetId) {
  const source = getTableSource(env, tableKey);
  if (source === "psql") {
    const psqlName = getTablePsqlName(env, tableKey);
    const result = await queryPostgres(env, "SELECT * FROM " + quoteIdentifierPath(psqlName), []);
    if (result.error) throw new Error(result.error);
    const rows = result.rows || [];
    if (rows.length === 0) return { values: [] };
    const headers = Object.keys(rows[0]);
    const values = [headers];
    for (const row of rows) {
      values.push(headers.map(h => row[h]));
    }
    return { values };
  } else {
    const sheetName = getTableSheetName(env, tableKey);
    if (!sheetName || !spreadsheetId) return { values: [] };
    return getSheetValues(env, spreadsheetId, `${quoteSheetName(sheetName)}!A:ZZ`).catch(() => ({ values: [] }));
  }
}
