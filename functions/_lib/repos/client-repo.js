import { psqlFindOne, psqlInsertRow, psqlSelectRows, psqlUpdateRows } from "../psql-adapter.js";
import { cleanEmail, objectPick } from "./repo-utils.js";
import { queryPostgres } from "../postgres.js";
import { getUserInfo } from "../user-roles.js";

/**
 * Resolve client access context:
 * Checks pdc_client_contract_info, pdc_user_roles (assigned company), pdc_inquiry management,
 * and @eiu.edu.vn domain default.
 */
export async function resolveClientAccessContextPsql(env, email) {
  const clean = cleanEmail(email);
  if (!clean) return null;

  // 1. Direct contract profile
  const directProfile = await psqlFindOne(env, "CLIENT_PROFILE", { "client updater email": clean });
  if (directProfile && directProfile["client id"]) {
    return {
      clientId: directProfile["client id"],
      clientNameVn: directProfile["client name vn"] || "",
      clientNameEn: directProfile["client name en"] || "",
      isEiu: String(directProfile["client id"]).toUpperCase() === "EIU" || clean.endsWith("@eiu.edu.vn"),
      clientScope: null,
      source: "contract",
      profile: directProfile
    };
  }

  // 2. Assigned company in pdc_user_roles
  const userInfo = await getUserInfo(env, clean);
  if (userInfo && userInfo.companyId) {
    let companyName = userInfo.companyName || "";
    if (!companyName && userInfo.companyId.toUpperCase() === "EIU") {
      companyName = "Eastern International University";
    }
    return {
      clientId: userInfo.companyId,
      clientNameVn: companyName,
      clientNameEn: companyName,
      isEiu: userInfo.companyId.toUpperCase() === "EIU" || clean.endsWith("@eiu.edu.vn"),
      clientScope: userInfo.clientScope || null,
      source: "roles",
      profile: {
        "client id": userInfo.companyId,
        "client updater email": clean,
        "client name vn": companyName,
        "client name en": companyName,
        "tax code": "",
        "representative name vn": "",
        "representative position vn": ""
      }
    };
  }

  // 3. Inquiry representative email
  try {
    const inqRes = await queryPostgres(env, `
      SELECT "client id", "client representative name"
      FROM public."pdc_inquiry management"
      WHERE LOWER(TRIM("client representative email")) = $1
      LIMIT 1
    `, [clean]);
    if (inqRes.rows && inqRes.rows.length > 0) {
      const row = inqRes.rows[0];
      const cid = row["client id"];
      // Lookup company name from oce_industry_list or contract
      let cname = cid;
      const oceRes = await queryPostgres(env, `
        SELECT company_name_vn, company_name_en FROM public.oce_industry_list WHERE LOWER(TRIM(company_id)) = LOWER(TRIM($1)) LIMIT 1
      `, [cid]);
      if (oceRes.rows && oceRes.rows.length > 0) {
        cname = oceRes.rows[0].company_name_vn || oceRes.rows[0].company_name_en || cid;
      }
      return {
        clientId: cid,
        clientNameVn: cname,
        clientNameEn: cname,
        isEiu: String(cid).toUpperCase() === "EIU" || clean.endsWith("@eiu.edu.vn"),
        clientScope: null,
        source: "inquiry",
        profile: {
          "client id": cid,
          "client updater email": clean,
          "client name vn": cname,
          "client name en": cname
        }
      };
    }
  } catch (_) {}

  // 4. EIU domain default: any @eiu.edu.vn user with client role defaults to EIU
  if (clean.endsWith("@eiu.edu.vn")) {
    return {
      clientId: "EIU",
      clientNameVn: "Trường Đại học Quốc tế Miền Đông",
      clientNameEn: "Eastern International University",
      isEiu: true,
      clientScope: null,
      source: "domain_eiu",
      profile: {
        "client id": "EIU",
        "client updater email": clean,
        "client name vn": "Trường Đại học Quốc tế Miền Đông",
        "client name en": "Eastern International University",
        "client address vn": "Đường Nam Kỳ Khởi Nghĩa, Phường Hòa Phú, TP. Thủ Dầu Một, Bình Dương",
        "client address en": "Nam Ky Khoi Nghia Street, Hoa Phu Ward, Thu Dau Mot City, Binh Duong"
      }
    };
  }

  return null;
}

export async function getClientProfilePsql(env, email) {
  const clean = cleanEmail(email);
  const direct = await psqlFindOne(env, "CLIENT_PROFILE", { "client updater email": clean });
  if (direct) return direct;

  // Fallback to resolved context
  const context = await resolveClientAccessContextPsql(env, clean);
  return context ? context.profile : null;
}

export async function updateClientProfilePsql(env, clientIdOrEmail, data = {}, options = {}) {
  const blocked = new Set([
    "client id", "client updater email"
  ]);
  const update = {};
  for (const [key, value] of Object.entries(data || {})) {
    const cleanKey = String(key || "").toLowerCase().trim();
    if (!blocked.has(cleanKey) && !cleanKey.startsWith("__")) update[cleanKey] = value;
  }
  const key = String(clientIdOrEmail || "").trim();
  const where = key.includes("@") ? { "client updater email": cleanEmail(key) } : { "client id": key };
  return psqlUpdateRows(env, "CLIENT_PROFILE", where, update, options);
}

export async function getClientInquiriesPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const limit = options.limit || 200;
  // Generic adapter supports AND where only; this route needs OR ownership.
  // Use a parameterized custom query when this repo is wired later.
  const rowsA = await psqlSelectRows(env, "CLIENT_INQUIRY", { where: { "client representative email": clean }, limit });
  const rowsB = await psqlSelectRows(env, "CLIENT_INQUIRY", { where: { "internal requester": clean }, limit });
  const seen = new Set();
  return [...rowsA, ...rowsB].filter((row) => {
    const id = String(row["inquiry id"] || JSON.stringify(row));
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function updateClientInquiryPsql(env, inquiryId, data = {}, options = {}) {
  const blocked = new Set([
    "inquiry id", "client id", "bd incharge", "inquiry created datetime", "inquiry status",
    "inquiry completed datetime", "inquiry completed by", "client representative",
    "client representative name", "client representative email", "internal requester"
  ]);
  const update = {};
  for (const [key, value] of Object.entries(data || {})) {
    const cleanKey = String(key || "").toLowerCase().trim();
    if (!blocked.has(cleanKey)) update[cleanKey] = value;
  }
  return psqlUpdateRows(env, "CLIENT_INQUIRY", { "inquiry id": String(inquiryId || "").trim() }, update, options);
}

export async function getClientInquiryPsql(env, inquiryId) {
  return psqlFindOne(env, "CLIENT_INQUIRY", { "inquiry id": String(inquiryId || "").trim() });
}

export async function insertClientInquiryPsql(env, data = {}, options = {}) {
  return psqlInsertRow(env, "CLIENT_INQUIRY", data, options);
}

/**
 * Get comprehensive trainee profiles for a client organization or EIU scope.
 * Supports:
 * - Corporate Clients: trainees matching client_id or enrolled in sections of client_id
 * - EIU Clients: trainees with @eiu.edu.vn or trainee organization id = EIU,
 *   grouped by Staff / Student, and by School / Department.
 */
export async function getClientTraineesPsql(env, email, options = {}) {
  const clean = cleanEmail(email);
  const context = await resolveClientAccessContextPsql(env, clean);
  if (!context) {
    return {
      ok: false,
      error: "Client access context not found.",
      clientInfo: null,
      summary: {},
      groups: { byType: {}, bySchool: {} },
      trainees: []
    };
  }

  const { clientId, clientNameVn, clientNameEn, isEiu, clientScope } = context;

  // 1. Fetch Trainees
  let traineesSql = "";
  let traineesParams = [];

  if (isEiu) {
    // EIU Scope: all trainees with @eiu.edu.vn or org id = 'EIU' or org name ILIKE '%Eastern International%' or '%Miền Đông%'
    traineesSql = `
      SELECT 
        t."trainee id" AS trainee_id,
        t."trainee email" AS email,
        t."trainee full name" AS full_name,
        t."trainee phone" AS phone,
        t."trainee gender" AS gender,
        t."trainee position" AS position,
        t."trainee organization id" AS organization_id,
        t."trainee organization new" AS organization_name,
        t."trainee type" AS raw_type,
        t."school" AS school_id,
        t."department" AS department_id,
        so.name AS school_name,
        so.school_office_type AS school_type,
        sp.program_function AS department_name,
        ti.school AS team_school,
        ti.position AS team_position
      FROM public."pdc_trainee general profile" t
      LEFT JOIN public.setting_school_office so ON t."school" = so.id
      LEFT JOIN public.setting_school_program sp ON t."department" = sp.id
      LEFT JOIN public."Team Information" ti ON LOWER(TRIM(ti.email_id_key)) = LOWER(TRIM(t."trainee email"))
      WHERE LOWER(TRIM(t."trainee email")) LIKE '%@eiu.edu.vn'
         OR LOWER(TRIM(t."trainee organization id")) = 'eiu'
         OR LOWER(TRIM(t."trainee organization new")) ILIKE '%eastern international university%'
         OR LOWER(TRIM(t."trainee organization new")) ILIKE '%miền đông%'
      ORDER BY t."trainee full name" ASC
    `;
  } else {
    // Corporate client scope: match organization ID, company name, or section attendee enrollment
    traineesSql = `
      SELECT DISTINCT
        t."trainee id" AS trainee_id,
        t."trainee email" AS email,
        t."trainee full name" AS full_name,
        t."trainee phone" AS phone,
        t."trainee gender" AS gender,
        t."trainee position" AS position,
        t."trainee organization id" AS organization_id,
        t."trainee organization new" AS organization_name,
        t."trainee type" AS raw_type,
        t."school" AS school_id,
        t."department" AS department_id,
        so.name AS school_name,
        so.school_office_type AS school_type,
        sp.program_function AS department_name,
        NULL AS team_school,
        NULL AS team_position
      FROM public."pdc_trainee general profile" t
      LEFT JOIN public.setting_school_office so ON t."school" = so.id
      LEFT JOIN public.setting_school_program sp ON t."department" = sp.id
      LEFT JOIN public."pdc_section attendee management" sa ON LOWER(TRIM(sa."trainee id")) = LOWER(TRIM(t."trainee id"))
      LEFT JOIN public."pdc_section management" sm ON LOWER(TRIM(sm."section id")) = LOWER(TRIM(sa."section id"))
      WHERE LOWER(TRIM(t."trainee organization id")) = LOWER(TRIM($1))
         OR LOWER(TRIM(t."trainee organization new")) = LOWER(TRIM($2))
         OR LOWER(TRIM(t."trainee organization new")) = LOWER(TRIM($3))
         OR LOWER(TRIM(sm."client id")) = LOWER(TRIM($1))
      ORDER BY t."trainee full name" ASC
    `;
    traineesParams = [clientId, clientNameVn || clientId, clientNameEn || clientId];
  }

  const traineesRes = await queryPostgres(env, traineesSql, traineesParams);
  const rawTrainees = traineesRes.rows || [];

  // Helper for determining EIU Trainee Type (Staff vs Student)
  function resolveTraineeType(emailStr, rawTypeVal, posVal) {
    const cleanE = String(emailStr || "").toLowerCase().trim();
    if (cleanE.endsWith("@eiu.edu.vn")) {
      const studentRegex = /\.(bbs|sns|cit|set|mba)\d+@eiu\.edu\.vn$/;
      if (studentRegex.test(cleanE) || cleanE === "eoffice2@eiu.edu.vn" || String(rawTypeVal).toLowerCase() === "student" || String(posVal).toLowerCase() === "student") {
        return "Student";
      }
      return "Staff";
    }
    return rawTypeVal || "Industry";
  }

  // 2. Fetch Section Enrollments & Courses for all retrieved trainees
  const traineeIds = rawTrainees.map(r => r.trainee_id || r.email).filter(Boolean);
  let courseHistoryMap = new Map();

  if (traineeIds.length > 0) {
    try {
      const historySql = `
        SELECT 
          sa."trainee id" AS trainee_id,
          sm."section id" AS section_id,
          sm."section name vn" AS section_name,
          sm."course id" AS course_id,
          cm."course name vn" AS course_name,
          sm."learning date start" AS learning_start,
          sm."learning date end" AS learning_end,
          sm."section status" AS section_status,
          COALESCE(att_plan.total_slots, 0) AS total_slots,
          COALESCE(att_log.checked_slots, 0) AS checked_slots,
          COALESCE(fb_req.total_surveys, 0) AS total_surveys,
          COALESCE(fb_sub.submitted_surveys, 0) AS submitted_surveys,
          sa."trainee cetificate link" AS certificate_link
        FROM public."pdc_section attendee management" sa
        JOIN public."pdc_section management" sm ON LOWER(TRIM(sm."section id")) = LOWER(TRIM(sa."section id"))
        LEFT JOIN public."pdc_course master list" cm ON LOWER(TRIM(cm."course id")) = LOWER(TRIM(sm."course id"))
        LEFT JOIN (
          SELECT "section id", COUNT(*)::int AS total_slots
          FROM public."pdc_section checkin management"
          GROUP BY "section id"
        ) att_plan ON LOWER(TRIM(att_plan."section id")) = LOWER(TRIM(sa."section id"))
        LEFT JOIN (
          SELECT "section id", "trainee id", COUNT(*)::int AS checked_slots
          FROM public."pdc_section checkin log"
          GROUP BY "section id", "trainee id"
        ) att_log ON LOWER(TRIM(att_log."section id")) = LOWER(TRIM(sa."section id")) 
                 AND LOWER(TRIM(att_log."trainee id")) = LOWER(TRIM(sa."trainee id"))
        LEFT JOIN (
          SELECT "section id", COUNT(*)::int AS total_surveys
          FROM public.pdc_fb_sectionforms
          GROUP BY "section id"
        ) fb_req ON LOWER(TRIM(fb_req."section id")) = LOWER(TRIM(sa."section id"))
        LEFT JOIN (
          SELECT "section id", "trainee email", COUNT(*)::int AS submitted_surveys
          FROM public.pdc_fb_submissions
          GROUP BY "section id", "trainee email"
        ) fb_sub ON LOWER(TRIM(fb_sub."section id")) = LOWER(TRIM(sa."section id"))
                 AND LOWER(TRIM(fb_sub."trainee email")) = LOWER(TRIM(sa."trainee id"))
        WHERE LOWER(TRIM(sa."trainee id")) = ANY($1::text[])
        ORDER BY sm."learning date start" DESC NULLS LAST
      `;
      const histRes = await queryPostgres(env, historySql, [traineeIds.map(s => s.toLowerCase().trim())]);
      (histRes.rows || []).forEach(row => {
        const tid = String(row.trainee_id || "").toLowerCase().trim();
        if (!courseHistoryMap.has(tid)) courseHistoryMap.set(tid, []);
        courseHistoryMap.get(tid).push(row);
      });
    } catch (e) {
      console.warn("Notice: could not load full course history details for trainees:", e.message);
    }
  }

  // 3. Transform & Aggregate Trainee Profiles
  let totalCheckedSlotsAll = 0;
  let totalSlotsAll = 0;
  let totalSurveysSubmittedAll = 0;
  let totalSurveysRequiredAll = 0;
  let totalEnrollmentsAll = 0;

  const byTypeGroups = {
    Staff: { count: 0, enrollments: 0, checkedSlots: 0, totalSlots: 0, surveysSubmitted: 0, surveysRequired: 0 },
    Student: { count: 0, enrollments: 0, checkedSlots: 0, totalSlots: 0, surveysSubmitted: 0, surveysRequired: 0 },
    Industry: { count: 0, enrollments: 0, checkedSlots: 0, totalSlots: 0, surveysSubmitted: 0, surveysRequired: 0 }
  };

  const bySchoolGroups = {};

  const trainees = rawTrainees.map(r => {
    const tid = String(r.trainee_id || r.email || "").toLowerCase().trim();
    const courses = courseHistoryMap.get(tid) || [];
    const type = resolveTraineeType(r.email, r.raw_type, r.position);

    let traineeCheckedSlots = 0;
    let traineeTotalSlots = 0;
    let traineeSurveysSub = 0;
    let traineeSurveysReq = 0;

    courses.forEach(c => {
      traineeCheckedSlots += Number(c.checked_slots || 0);
      traineeTotalSlots += Number(c.total_slots || 0);
      traineeSurveysSub += Number(c.submitted_surveys || 0);
      traineeSurveysReq += Number(c.total_surveys || 0);
    });

    totalEnrollmentsAll += courses.length;
    totalCheckedSlotsAll += traineeCheckedSlots;
    totalSlotsAll += traineeTotalSlots;
    totalSurveysSubmittedAll += traineeSurveysSub;
    totalSurveysRequiredAll += traineeSurveysReq;

    // Aggregate by Type
    if (byTypeGroups[type]) {
      byTypeGroups[type].count++;
      byTypeGroups[type].enrollments += courses.length;
      byTypeGroups[type].checkedSlots += traineeCheckedSlots;
      byTypeGroups[type].totalSlots += traineeTotalSlots;
      byTypeGroups[type].surveysSubmitted += traineeSurveysSub;
      byTypeGroups[type].surveysRequired += traineeSurveysReq;
    }

    // Determine School / Department name
    const schoolName = r.school_name || r.team_school || (isEiu ? "Unassigned School/Office" : (r.organization_name || "General"));
    const deptName = r.department_name || r.position || "General";

    if (!bySchoolGroups[schoolName]) {
      bySchoolGroups[schoolName] = {
        name: schoolName,
        schoolType: r.school_type || "School",
        count: 0,
        staffCount: 0,
        studentCount: 0,
        enrollments: 0,
        checkedSlots: 0,
        totalSlots: 0,
        departments: {}
      };
    }
    bySchoolGroups[schoolName].count++;
    if (type === "Staff") bySchoolGroups[schoolName].staffCount++;
    if (type === "Student") bySchoolGroups[schoolName].studentCount++;
    bySchoolGroups[schoolName].enrollments += courses.length;
    bySchoolGroups[schoolName].checkedSlots += traineeCheckedSlots;
    bySchoolGroups[schoolName].totalSlots += traineeTotalSlots;

    if (!bySchoolGroups[schoolName].departments[deptName]) {
      bySchoolGroups[schoolName].departments[deptName] = { name: deptName, count: 0, staffCount: 0, studentCount: 0 };
    }
    bySchoolGroups[schoolName].departments[deptName].count++;
    if (type === "Staff") bySchoolGroups[schoolName].departments[deptName].staffCount++;
    if (type === "Student") bySchoolGroups[schoolName].departments[deptName].studentCount++;

    const attendancePct = traineeTotalSlots > 0 ? Math.round((traineeCheckedSlots / traineeTotalSlots) * 100) : null;
    const surveyPct = traineeSurveysReq > 0 ? Math.round((traineeSurveysSub / traineeSurveysReq) * 100) : null;

    return {
      traineeId: r.trainee_id || r.email,
      email: r.email,
      fullName: r.full_name || "(No Name)",
      phone: r.phone || "",
      gender: r.gender || "",
      position: r.position || r.team_position || "",
      type,
      schoolId: r.school_id || "",
      schoolName,
      departmentId: r.department_id || "",
      departmentName: deptName,
      organizationId: r.organization_id || clientId,
      organizationName: r.organization_name || clientNameVn,
      totalCourses: courses.length,
      attendance: {
        checkedSlots: traineeCheckedSlots,
        totalSlots: traineeTotalSlots,
        pct: attendancePct
      },
      surveys: {
        submitted: traineeSurveysSub,
        required: traineeSurveysReq,
        pct: surveyPct
      },
      courses: courses.map(c => ({
        sectionId: c.section_id,
        sectionName: c.section_name || c.section_id,
        courseId: c.course_id,
        courseName: c.course_name || c.course_id,
        learningStart: c.learning_start,
        learningEnd: c.learning_end,
        sectionStatus: c.section_status,
        checkedSlots: Number(c.checked_slots || 0),
        totalSlots: Number(c.total_slots || 0),
        attendancePct: Number(c.total_slots || 0) > 0 ? Math.round((Number(c.checked_slots || 0) / Number(c.total_slots || 0)) * 100) : null,
        submittedSurveys: Number(c.submitted_surveys || 0),
        totalSurveys: Number(c.total_surveys || 0),
        certificateLink: c.certificate_link || ""
      }))
    };
  });

  const overallAttendancePct = totalSlotsAll > 0 ? Math.round((totalCheckedSlotsAll / totalSlotsAll) * 100) : 0;
  const overallSurveyPct = totalSurveysRequiredAll > 0 ? Math.round((totalSurveysSubmittedAll / totalSurveysRequiredAll) * 100) : 0;

  return {
    ok: true,
    clientInfo: {
      clientId,
      clientNameVn,
      clientNameEn,
      isEiu,
      clientScope
    },
    summary: {
      totalTrainees: trainees.length,
      totalEnrollments: totalEnrollmentsAll,
      overallAttendancePct,
      overallSurveyPct,
      totalCheckedSlots: totalCheckedSlotsAll,
      totalSlots: totalSlotsAll
    },
    groups: {
      byType: byTypeGroups,
      bySchool: bySchoolGroups
    },
    trainees
  };
}
