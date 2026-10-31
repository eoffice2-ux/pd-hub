import { jsonResponse, requireAdminOrDebug, requireAdminSession, requireReportSession, isAdminEmail, normalizeEmail } from "../../_lib/security.js";
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
    const sessionAuth = await requireReportSession(request, env);
    if (!sessionAuth.ok) return sessionAuth.response;
    const sessionRoles = Array.isArray(sessionAuth.session.roles) ? sessionAuth.session.roles : [sessionAuth.session.scope];
    const role = await getUserRole(env, sessionAuth.session.email);
    const isEnvAdmin = isAdminEmail(sessionAuth.session.email, env);
    const hasReportAccess = isEnvAdmin ||
                            sessionRoles.includes("super_user") ||
                            sessionRoles.includes("admin") ||
                            sessionRoles.includes("report_viewer") ||
                            role === "admin" ||
                            role === "super_user" ||
                            role === "report_viewer";
    if (!hasReportAccess) {
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
        const normType = normalizeQuestionType(q.type);
        let kind = "text";
        if (normType === "radio") kind = "single";
        else if (normType === "checkbox") kind = "multi";
        else if (normType === "scale" || normType === "rating") kind = "scale";
        else if (normType === "nps") kind = "nps";
        else if (normType === "text" || normType === "short_text" || normType === "long_text") kind = "text";
        else kind = "text"; // unknown types fallback to text

        let answeredCount = 0;

        if (kind === "single") {
          const declaredOptions = parseSemicolonOptions(q.options);
          const countMap = {};
          declaredOptions.forEach((opt) => { countMap[opt] = 0; });

          for (const sub of mappingSubs) {
            const subAnswers = responsesBySubmission[sub.submissionId] || {};
            const rawAns = subAnswers[q.questionId];
            if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
            answeredCount++;
            const ansStr = String(rawAns).trim();
            countMap[ansStr] = (countMap[ansStr] || 0) + 1;
          }

          const allOptions = Array.from(new Set([...declaredOptions, ...Object.keys(countMap)]));
          const options = allOptions.map((opt) => ({
            label: opt,
            count: countMap[opt] || 0,
            percent: answeredCount > 0 ? Math.round(((countMap[opt] || 0) / answeredCount) * 1000) / 10 : 0
          }));

          return {
            questionId: q.questionId,
            text: q.text,
            type: normType || "radio",
            kind: "single",
            optionsStr: q.options,
            answered: answeredCount,
            options,
            distribution: countMap
          };
        }

        if (kind === "multi") {
          const declaredOptions = parseSemicolonOptions(q.options);
          const countMap = {};
          declaredOptions.forEach((opt) => { countMap[opt] = 0; });

          for (const sub of mappingSubs) {
            const subAnswers = responsesBySubmission[sub.submissionId] || {};
            const rawAns = subAnswers[q.questionId];
            if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
            answeredCount++;
            const ansStr = String(rawAns).trim();

            const selectedThisSub = new Set();
            const tokens = ansStr.split(/,\s*|;\s*/).map((s) => s.trim()).filter(Boolean);

            for (const opt of declaredOptions) {
              if (tokens.includes(opt) || ansStr === opt) {
                selectedThisSub.add(opt);
              }
            }

            for (const token of tokens) {
              let matched = false;
              for (const opt of declaredOptions) {
                if (opt.toLowerCase() === token.toLowerCase()) {
                  selectedThisSub.add(opt);
                  matched = true;
                  break;
                }
              }
              if (!matched && token) {
                selectedThisSub.add(token);
              }
            }

            for (const chosen of selectedThisSub) {
              countMap[chosen] = (countMap[chosen] || 0) + 1;
            }
          }

          const allOptions = Array.from(new Set([...declaredOptions, ...Object.keys(countMap)]));
          const options = allOptions.map((opt) => ({
            label: opt,
            count: countMap[opt] || 0,
            percent: answeredCount > 0 ? Math.round(((countMap[opt] || 0) / answeredCount) * 1000) / 10 : 0
          }));

          return {
            questionId: q.questionId,
            text: q.text,
            type: normType || "checkbox",
            kind: "multi",
            optionsStr: q.options,
            answered: answeredCount,
            options,
            distribution: countMap
          };
        }

        if (kind === "scale") {
          let { min, max } = parseScaleRange(q.options);
          const countMap = {};
          let ratingSum = 0;
          let ratingCount = 0;
          const observedRatings = [];

          for (const sub of mappingSubs) {
            const subAnswers = responsesBySubmission[sub.submissionId] || {};
            const rawAns = subAnswers[q.questionId];
            if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
            answeredCount++;
            const num = parseFloat(String(rawAns).trim());
            if (Number.isFinite(num)) {
              ratingSum += num;
              ratingCount++;
              const key = Math.round(num);
              observedRatings.push(key);
              countMap[key] = (countMap[key] || 0) + 1;
            }
          }

          if (observedRatings.length > 0) {
            min = Math.min(min, ...observedRatings);
            max = Math.max(max, ...observedRatings);
          }
          if (max < 5 && min >= 1) {
            max = 5;
          }

          const levels = [];
          for (let lvl = min; lvl <= max; lvl++) {
            levels.push(lvl);
            if (countMap[lvl] === undefined) countMap[lvl] = 0;
          }

          const average = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0;
          const options = levels.map((lvl) => ({
            label: `${lvl} sao`,
            level: lvl,
            count: countMap[lvl] || 0,
            percent: answeredCount > 0 ? Math.round(((countMap[lvl] || 0) / answeredCount) * 1000) / 10 : 0
          }));

          return {
            questionId: q.questionId,
            text: q.text,
            type: normType || "scale",
            kind: "scale",
            optionsStr: q.options,
            min,
            max,
            average,
            answered: answeredCount,
            options,
            distribution: countMap
          };
        }

        if (kind === "nps") {
          const countMap = {};
          for (let lvl = 0; lvl <= 10; lvl++) {
            countMap[lvl] = 0;
          }
          let sum = 0;
          let npsCount = 0;
          let promoterCount = 0;
          let passiveCount = 0;
          let detractorCount = 0;

          for (const sub of mappingSubs) {
            const subAnswers = responsesBySubmission[sub.submissionId] || {};
            const rawAns = subAnswers[q.questionId];
            if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
            answeredCount++;
            const num = parseInt(String(rawAns).trim(), 10);
            if (Number.isFinite(num) && num >= 0 && num <= 10) {
              sum += num;
              npsCount++;
              countMap[num] = (countMap[num] || 0) + 1;
              if (num >= 9) promoterCount++;
              else if (num >= 7) passiveCount++;
              else detractorCount++;
            }
          }

          const promoterPct = answeredCount > 0 ? Math.round((promoterCount / answeredCount) * 1000) / 10 : 0;
          const passivePct = answeredCount > 0 ? Math.round((passiveCount / answeredCount) * 1000) / 10 : 0;
          const detractorPct = answeredCount > 0 ? Math.round((detractorCount / answeredCount) * 1000) / 10 : 0;
          const npsScore = Math.round(promoterPct - detractorPct);
          const average = npsCount > 0 ? Math.round((sum / npsCount) * 10) / 10 : 0;

          const options = Array.from({ length: 11 }, (_, i) => ({
            label: String(i),
            level: i,
            count: countMap[i] || 0,
            percent: answeredCount > 0 ? Math.round(((countMap[i] || 0) / answeredCount) * 1000) / 10 : 0
          }));

          return {
            questionId: q.questionId,
            text: q.text,
            type: normType || "nps",
            kind: "nps",
            optionsStr: q.options,
            npsScore,
            average,
            answered: answeredCount,
            groups: {
              promoters: { count: promoterCount, percent: promoterPct },
              passives: { count: passiveCount, percent: passivePct },
              detractors: { count: detractorCount, percent: detractorPct }
            },
            options,
            distribution: countMap
          };
        }

        // Default: text quotes (for text, short_text, long_text, and unknown types)
        const texts = [];
        for (const sub of mappingSubs) {
          const subAnswers = responsesBySubmission[sub.submissionId] || {};
          const rawAns = subAnswers[q.questionId];
          if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
          answeredCount++;
          const ansStr = String(rawAns).trim();
          texts.push({
            text: ansStr,
            email: sub.email || "",
            submittedAt: sub.submittedAt || ""
          });
        }

        texts.sort((a, b) => Date.parse(b.submittedAt || 0) - Date.parse(a.submittedAt || 0));

        return {
          questionId: q.questionId,
          text: q.text,
          type: normType || "text",
          kind: "text",
          optionsStr: q.options,
          answered: answeredCount,
          texts
        };
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

function normalizeQuestionType(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseSemicolonOptions(optionsStr) {
  if (!optionsStr) return [];
  return String(optionsStr)
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseScaleRange(optionsStr) {
  let min = 1;
  let max = 5;
  if (optionsStr) {
    const nums = String(optionsStr)
      .match(/\b\d+\b/g)
      ?.map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
    if (nums && nums.length >= 2) {
      min = Math.min(...nums);
      max = Math.max(...nums);
    } else if (nums && nums.length === 1 && nums[0] > 1) {
      min = 1;
      max = nums[0];
    }
  }
  return { min, max };
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
