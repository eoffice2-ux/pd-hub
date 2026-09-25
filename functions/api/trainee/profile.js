import { assertEmailAllowed, jsonResponse, jsonResponseCacheable, requireTraineeSession } from "../../_lib/security.js";
import { buildTraineeProfile, findTraineeRow, readTraineeTable, getUserType } from "../../_lib/trainee-gsheet.js";
import { isPsql } from "../../_lib/repos/repo-utils.js";
import { getTraineeProfilePsql } from "../../_lib/repos/trainee-profile-repo.js";
import { queryPostgres } from "../../_lib/postgres.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const emailCheck = assertEmailAllowed(url.searchParams.get("email"), auth.session.email);
  if (!emailCheck.ok) return emailCheck.response;

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return jsonResponseCacheable({
      success: true,
      source: "mock",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: emailCheck.email,
      data: buildMockTraineeProfile(emailCheck.email)
    });
  }

  if (isPsql(env, "TRAINEE_PROFILE")) {
    try {
      const row = await getTraineeProfilePsql(env, emailCheck.email);
      const cleanEmail = emailCheck.email.toLowerCase().replace(/\s/g, "").trim();
      let profileData;
      if (!row) {
        profileData = { isNew: true, email: cleanEmail, hasPin: false, traineeType: getUserType(cleanEmail) };
      } else {
        const fullName = row["trainee full name"];
        const pin = row["trainee pin"];
        if (!fullName || String(fullName).trim() === "") {
          profileData = {
            isNew: true,
            email: cleanEmail,
            hasPin: String(pin || "").trim() !== "",
            traineeType: getUserType(cleanEmail)
          };
        } else {
          profileData = {
            isNew: false,
            email: cleanEmail,
            fullName,
            phone: row["trainee phone"],
            gender: row["trainee gender"],
            organization: row["trainee organization new"],
            organizationId: row["trainee organization id"],
            position: row["trainee position"],
            school: row["school"],
            department: row["department"],
            traineeType: getUserType(cleanEmail),
            hasPin: String(pin || "").trim() !== ""
          };
        }
      }

      if (profileData.isNew && profileData.traineeType === "Staff") {
        try {
          const teamInfo = await queryPostgres(env, `SELECT * FROM public."Team Information" WHERE email_id_key = $1`, [profileData.email]);
          if (teamInfo.rows && teamInfo.rows.length > 0) {
            const staff = teamInfo.rows[0];
            profileData.fullName = staff.full_name;
            profileData.position = staff.position;
            
            const genderVal = String(staff.gender || "").trim();
            if (genderVal === "Male" || genderVal === "Female") {
              profileData.gender = genderVal;
            }
            
            const schoolVal = String(staff.school || "").trim();
            if (schoolVal && !schoolVal.includes(",")) {
              const schoolLookup = await queryPostgres(env, `SELECT id FROM public.setting_school_office WHERE school_office ILIKE $1`, [schoolVal]);
              if (schoolLookup.rows && schoolLookup.rows.length > 0) {
                profileData.school = schoolLookup.rows[0].id;
              }
            }
          }
        } catch (e) {
          console.error("Error prefilling staff profile:", e);
        }
      } else if (profileData.isNew && profileData.traineeType === "Student") {
        profileData.position = "Student";
      }

      return jsonResponseCacheable({
        success: true,
        source: "psql",
        dbMode,
        authenticatedEmail: auth.session.email,
        requestedEmail: emailCheck.email,
        row: null,
        data: profileData
      });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const { values, headers } = await readTraineeTable(env);
    const found = findTraineeRow(values, headers, emailCheck.email);
    return jsonResponseCacheable({
      success: true,
      source: "gsheet",
      dbMode,
      authenticatedEmail: auth.session.email,
      requestedEmail: emailCheck.email,
      row: found?.sheetRowNumber || null,
      data: buildTraineeProfile(found?.row, headers, emailCheck.email)
    });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}

export async function onRequestPost() {
  return jsonResponse({ success: false, error: "Method not allowed. Use GET /api/trainee/profile" }, 405);
}

function buildMockTraineeProfile(email) {
  return {
    isNew: false,
    email,
    fullName: "Demo Trainee",
    phone: "0900000000",
    gender: "Other",
    organization: email.endsWith("@eiu.edu.vn") ? "Eastern International University" : "Demo Company Limited",
    organizationId: email.endsWith("@eiu.edu.vn") ? "EIU" : "ORG-DEMO-001",
    position: email.endsWith("@eiu.edu.vn") ? "Staff" : "HR Specialist",
    traineeType: email.endsWith("@eiu.edu.vn") ? "Staff" : "Industry",
    hasPin: true
  };
}
