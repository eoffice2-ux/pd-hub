import { jsonResponse, requireTraineeSession } from "../../../_lib/security.js";
import { getTraineeSectionDetailsFromSheet } from "../../../_lib/trainee-gsheet.js";
import { isPsql } from "../../../_lib/repos/repo-utils.js";
import { getSectionDetailsPsql } from "../../../_lib/repos/section-repo.js";

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(context.request.url);
  const sectionId = String(url.searchParams.get("sectionId") || "").trim();
  if (!sectionId) return jsonResponse({ success: false, error: "Missing sectionId." }, 400);

  const dbMode = String(env.DB_MODE || "gsheet").toLowerCase();
  if (dbMode === "mock") {
    return jsonResponse({
      success: true,
      source: "mock",
      dbMode,
      authenticatedEmail: auth.session.email,
      data: {
        sectionId,
        sectionNumber: "DEMO-001",
        nameEn: "Project Management Essentials",
        nameVn: "Nền tảng Quản lý Dự án",
        date: "23/05/2026 08:30",
        traineeType: "Industry",
        sectionType: "Industry",
        venue: "Eastern International University",
        status: "Registration Open",
        bdIncharge: "bd.demo@eiu.edu.vn",
        courseId: "COURSE-DEMO-001",
        courseName: "Project Management Essentials",
        roomId: "ROOM-DEMO-001",
        roomTitle: "Room A101"
      }
    });
  }

  if (isPsql(env, "SECTION")) {
    try {
      const res = await getSectionDetailsPsql(env, sectionId);
      if (!res) return jsonResponse({ success: false, source: "psql", error: "Section not found in the database." }, 404);
      const details = mapSectionDetailsPsql(res.section, res.course, res.venue);
      return jsonResponse({ success: true, source: "psql", dbMode, authenticatedEmail: auth.session.email, data: details });
    } catch (err) {
      return jsonResponse({ success: false, source: "psql", error: err?.message || String(err) }, 500);
    }
  }

  try {
    const details = await getTraineeSectionDetailsFromSheet(env, sectionId);
    if (details?.error) return jsonResponse({ success: false, source: "gsheet", error: details.error }, 404);
    return jsonResponse({ success: true, source: "gsheet", dbMode, authenticatedEmail: auth.session.email, data: details });
  } catch (err) {
    return jsonResponse({ success: false, source: "gsheet", error: err?.message || String(err) }, 500);
  }
}

function mapSectionDetailsPsql(section, course, venue) {
  const sectionId = section["section id"] || section["section_id"] || "";
  const courseId = section["course id"] || section["course_id"] || "";
  const roomId = section["section room id"] || section["room id"] || section["room_id"] || "";
  
  const mapped = {
    sectionId,
    sectionNumber: section["section number"] || section["section_number"] || sectionId,
    nameEn: section["section name en"] || section["section_name_en"] || "N/A",
    nameVn: section["section name vn"] || section["section_name_vn"] || "N/A",
    date: section["section date"] || section["section_date"] || "N/A",
    traineeType: section["section trainee type"] || section["section_trainee_type"] || "N/A",
    sectionType: section["section type"] || section["section_type"] || "N/A",
    venue: section["section venue"] || section["section_venue"] || "N/A",
    status: section["section status"] || section["section_status"] || "N/A",
    bdIncharge: section["bd incharge id"] || section["bd_incharge_id"] || "N/A",
    courseId,
    roomId
  };
  
  mapped.courseName = (course ? (course["course name en"] || course["course_name_en"] || course["course name"] || course["course_name"]) : "") || mapped.nameEn;
  mapped.roomTitle = (venue ? (venue["room title"] || venue["room_title"] || venue["title"]) : "") || "N/A";
  
  return mapped;
}
