import { jsonResponse, requireDebugToken } from "../../_lib/security.js";
import { describeAllTables } from "../../_lib/data-source.js";
import { assertPostgresEnv } from "../../_lib/postgres.js";

const ADAPTER_STATUS = {
  CLIENT_PROFILE: { repo: "client-repo.js", psqlScaffold: true, routeWired: false, risk: "medium", notes: "Profile read/update helpers prepared; route still uses Google Sheet implementation until table-specific validation." },
  CLIENT_INQUIRY: { repo: "client-repo.js", psqlScaffold: true, routeWired: false, risk: "medium", notes: "Inquiry read/update helpers prepared; ownership/audit test required before cutover." },
  TRAINEE_PROFILE: { repo: "trainee-profile-repo.js", psqlScaffold: true, routeWired: false, risk: "medium", notes: "Profile/PIN helpers prepared; test access-type, PIN, update before cutover." },
  SECTION: { repo: "section-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only master table candidate after schema precheck." },
  SECTION_ATTENDEE: { repo: "registration-repo.js", psqlScaffold: true, routeWired: false, risk: "high", notes: "Registration table is write-sensitive; migrate after SECTION is stable." },
  COURSE_MASTER: { repo: "section-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only master table candidate." },
  VENUE: { repo: "section-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only master table candidate." },
  CHECKIN_PLAN: { repo: "checkin-repo.js", psqlScaffold: true, routeWired: false, risk: "medium", notes: "Read-only plan first; keep submit/log separate." },
  CHECKIN_LOG: { repo: "checkin-repo.js", psqlScaffold: true, routeWired: false, risk: "high", notes: "Write-sensitive; duplicate/time-window tests required before cutover." },
  FB_FORMS: { repo: "feedback-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only feedback metadata candidate." },
  FB_QUESTIONS: { repo: "feedback-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only feedback metadata candidate." },
  FB_SECTIONFORMS: { repo: "feedback-repo.js", psqlScaffold: true, routeWired: false, risk: "low", notes: "Read-only mapping candidate." },
  FB_SUBMISSIONS: { repo: "feedback-repo.js", psqlScaffold: true, routeWired: false, risk: "high", notes: "Write-sensitive; duplicate and time-window tests required." },
  FB_RESPONSES: { repo: "feedback-repo.js", psqlScaffold: true, routeWired: false, risk: "high", notes: "Write-sensitive; migrate together with FB_SUBMISSIONS." },
  ORGANIZATION: { repo: "organization-repo.js", psqlScaffold: true, routeWired: true, risk: "low", notes: "Already wired and tested via Hyperdrive." }
};

export async function onRequestGet(context) {
  const env = context.env || {};
  const debugAuth = requireDebugToken(context.request, env);
  if (!debugAuth.ok) return debugAuth.response;
  const psqlMissing = assertPostgresEnv(env);
  const tables = describeAllTables(env).map((table) => ({
    ...table,
    ...(ADAPTER_STATUS[table.tableKey] || { psqlScaffold: false, routeWired: false, risk: "unknown" })
  }));
  const counts = tables.reduce((acc, row) => {
    acc.total += 1;
    if (row.psqlScaffold) acc.psqlScaffold += 1;
    if (row.routeWired) acc.routeWired += 1;
    if (row.source === "psql") acc.activePsql += 1;
    return acc;
  }, { total: 0, psqlScaffold: 0, routeWired: 0, activePsql: 0 });

  return jsonResponse({
    success: true,
    purpose: "PSQL adapter/repository readiness. RouteWired=false means the helper exists but the production API still uses Google Sheet until a table-specific cutover step.",
    psqlConfigured: psqlMissing.length === 0,
    psqlMissing,
    counts,
    tables
  });
}
