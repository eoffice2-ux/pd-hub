import { jsonResponse, requireTraineeSession } from "../../../_lib/security.js";
import { getTableSource } from "../../../_lib/data-source.js";
import { searchOrganizationsPsql } from "../../../_lib/repos/organization-repo.js";

const MOCK_ORGS = [
  { id: "EIU", name: "Eastern International University" },
  { id: "ORG-DEMO-001", name: "Vietnam Singapore Industrial Park Joint Venture Company Limited" },
  { id: "ORG-DEMO-002", name: "Demo Manufacturing Company" },
  { id: "ORG-DEMO-003", name: "Demo Logistics Vietnam" }
];

export async function onRequestGet(context) {
  const env = context.env || {};
  const auth = await requireTraineeSession(context.request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const q = String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim();
  const source = getTableSource(env, "ORGANIZATION");

  if (q.length < 2) {
    return jsonResponse({ success: true, source, authenticatedEmail: auth.session.email, query: q, count: 0, data: [] });
  }

  if (source === "psql") {
    try {
      const data = await searchOrganizationsFromPostgres(env, q);
      return jsonResponse({ success: true, source: "psql", authenticatedEmail: auth.session.email, query: q, count: data.length, data });
    } catch (err) {
      // Organization search is a helper/autocomplete route. If PSQL is temporarily unavailable,
      // do not break the profile UI; return a safe empty/fallback response and expose a warning.
      const fallbackData = searchMockOrganizations(q);
      return jsonResponse({
        success: true,
        source: "psql",
        fallbackSource: "mock",
        degraded: true,
        authenticatedEmail: auth.session.email,
        query: q,
        count: fallbackData.length,
        data: fallbackData,
        warning: "PostgreSQL organization search failed; returned fallback data so the UI can continue.",
        psqlError: err?.message || String(err),
        psqlHint: err?.hint || "Check DATABASE_URL, SSL, firewall, and PostgreSQL logs."
      }, 200);
    }
  }

  const data = searchMockOrganizations(q);
  return jsonResponse({ success: true, source: "mock", authenticatedEmail: auth.session.email, query: q, count: data.length, data });
}

async function searchOrganizationsFromPostgres(env, query) {
  return searchOrganizationsPsql(env, query, { limit: 15 });
}

function searchMockOrganizations(query) {
  const clean = String(query || "").toLowerCase();
  return MOCK_ORGS.filter((item) => item.name.toLowerCase().includes(clean)).slice(0, 15);
}
