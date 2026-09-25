// PD One-Stop table-level data source registry.
// Goal: one table = one source. Read/write stay on the same source.
// Env pattern:
//   DB_MODE=gsheet                                 // default fallback
//   TAB_ORGANIZATION_SOURCE=psql                   // per-table source override
//   TAB_ORGANIZATION_GSHEET=pdc_org_sheet          // Google Sheet tab name override
//   TAB_ORGANIZATION_PSQL=public.org_table         // PostgreSQL table name override
//
// Backward compatibility is preserved for older env names:
//   SOURCE_ORGANIZATION, GSHEET_ORGANIZATION, PSQL_ORGANIZATION

export const TABLES = Object.freeze({
  EMAIL_LOG: {
    envKey: "EMAIL_LOG",
    defaultSource: "psql",
    gsheetName: "pdc_email_log",
    psqlName: "public.pdc_email_log"
  },
  CLIENT_PROFILE: {
    envKey: "CLIENT_PROFILE",
    defaultSource: "gsheet",
    gsheetName: "pdc_client_contract_info",
    psqlName: "public.pdc_client_contract_info"
  },
  CLIENT_INQUIRY: {
    envKey: "CLIENT_INQUIRY",
    defaultSource: "gsheet",
    gsheetName: "pdc-inquiry management",
    psqlName: "public.pdc_inquiry management"
  },
  TRAINEE_PROFILE: {
    envKey: "TRAINEE_PROFILE",
    defaultSource: "gsheet",
    gsheetName: "pdc_trainee general profile",
    psqlName: "public.pdc_trainee general profile"
  },
  SECTION: {
    envKey: "SECTION",
    defaultSource: "gsheet",
    gsheetName: "pdc_section management",
    psqlName: "public.pdc_section management"
  },
  SECTION_ATTENDEE: {
    envKey: "SECTION_ATTENDEE",
    defaultSource: "gsheet",
    gsheetName: "pdc_section attendee management",
    psqlName: "public.pdc_section attendee management"
  },
  COURSE_MASTER: {
    envKey: "COURSE_MASTER",
    defaultSource: "gsheet",
    gsheetName: "pdc_course master list",
    psqlName: "public.pdc_course master list"
  },
  VENUE: {
    envKey: "VENUE",
    defaultSource: "gsheet",
    gsheetName: "pdc-room lab management",
    psqlName: "public.pdc_room lab management"
  },
  CHECKIN_PLAN: {
    envKey: "CHECKIN_PLAN",
    defaultSource: "gsheet",
    gsheetName: "pdc_section checkin management",
    psqlName: "public.pdc_section checkin management"
  },
  CHECKIN_LOG: {
    envKey: "CHECKIN_LOG",
    defaultSource: "gsheet",
    gsheetName: "pdc_section checkin log",
    psqlName: "public.pdc_section checkin log"
  },
  FB_FORMS: {
    envKey: "FB_FORMS",
    defaultSource: "gsheet",
    gsheetName: "pdc_fb_forms",
    psqlName: "public.pdc_fb_forms"
  },
  FB_QUESTIONS: {
    envKey: "FB_QUESTIONS",
    defaultSource: "gsheet",
    gsheetName: "pdc_fb_questions",
    psqlName: "public.pdc_fb_questions"
  },
  FB_SUBMISSIONS: {
    envKey: "FB_SUBMISSIONS",
    defaultSource: "gsheet",
    gsheetName: "pdc_fb_submissions",
    psqlName: "public.pdc_fb_submissions"
  },
  FB_RESPONSES: {
    envKey: "FB_RESPONSES",
    defaultSource: "gsheet",
    gsheetName: "pdc_fb_responses",
    psqlName: "public.pdc_fb_responses"
  },
  FB_SECTIONFORMS: {
    envKey: "FB_SECTIONFORMS",
    defaultSource: "gsheet",
    gsheetName: "pdc_fb_sectionforms",
    psqlName: "public.pdc_fb_sectionforms"
  },
  USER_ROLES: {
    envKey: "USER_ROLES",
    defaultSource: "gsheet",
    gsheetName: "pdc_user_roles",
    psqlName: "public.pdc_user_roles"
  },
  LOGISTIC_LOG: {
    envKey: "LOGISTIC_LOG",
    defaultSource: "psql",
    gsheetName: "pdc_logistic_log",
    psqlName: "public.pdc_logistic_log"
  },
  PROPOSAL_DATEPROPOSAL: {
    envKey: "PROPOSAL_DATEPROPOSAL",
    defaultSource: "psql",
    gsheetName: "pdc_proposal dateproposal",
    psqlName: "public.pdc_proposal dateproposal"
  },
  ORGANIZATION: {
    envKey: "ORGANIZATION",
    defaultSource: "mock",
    gsheetName: "pdc_organization master list",
    psqlName: "public.oce_industry_list"
  }
});

export function normalizeSource(value, fallback = "gsheet") {
  const v = String(value || "").trim().toLowerCase();
  if (["psql", "postgres", "postgresql"].includes(v)) return "psql";
  if (["sheet", "sheets", "gsheet", "google_sheet", "google_sheets"].includes(v)) return "gsheet";
  if (["mock", "demo"].includes(v)) return "mock";
  return fallback;
}

export function getTableConfig(tableKey) {
  const key = String(tableKey || "").trim().toUpperCase();
  const config = TABLES[key];
  if (!config) throw new Error(`Unknown table key: ${tableKey}`);
  return config;
}

export function getTableSource(env = {}, tableKey) {
  const config = getTableConfig(tableKey);
  const primaryEnvName = `TAB_${config.envKey}_SOURCE`;
  const legacyEnvName = `SOURCE_${config.envKey}`;
  const fallback = normalizeSource(env.DB_MODE || config.defaultSource || "gsheet", config.defaultSource || "gsheet");
  return normalizeSource(env[primaryEnvName] || env[legacyEnvName], fallback);
}

export function getTableSheetName(env = {}, tableKey) {
  const config = getTableConfig(tableKey);
  const primaryEnvName = `TAB_${config.envKey}_GSHEET`;
  const legacyEnvName = `GSHEET_${config.envKey}`;
  return String(env[primaryEnvName] || env[legacyEnvName] || config.gsheetName || "").trim();
}

export function getTablePsqlName(env = {}, tableKey) {
  const config = getTableConfig(tableKey);
  const primaryEnvName = `TAB_${config.envKey}_PSQL`;
  const legacyEnvName = `PSQL_${config.envKey}`;
  return String(env[primaryEnvName] || env[legacyEnvName] || config.psqlName || "").trim();
}

export function describeTable(env = {}, tableKey) {
  return {
    tableKey: String(tableKey || "").trim().toUpperCase(),
    source: getTableSource(env, tableKey),
    gsheetName: getTableSheetName(env, tableKey),
    psqlName: getTablePsqlName(env, tableKey)
  };
}

export function describeAllTables(env = {}) {
  return Object.keys(TABLES).map((key) => describeTable(env, key));
}

// Defends dynamic PostgreSQL identifiers coming from env table names.
// Important for this project: many PostgreSQL table names contain spaces.
// We support schema.table paths such as:
//   public.pdc_section management
// and quote them safely as:
//   "public"."pdc_section management"
//
// Do NOT pass end-user input here. These values must come only from trusted env/config.
export function assertSafeSqlIdentifierPath(value, label = "table name") {
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`Missing ${label}.`);

  // Keep path format simple and predictable: table OR schema.table.
  const parts = raw.split(".");
  if (parts.length < 1 || parts.length > 2) throw new Error(`Invalid ${label}: ${raw}`);

  for (const part of parts) {
    if (!part || !String(part).trim()) throw new Error(`Invalid ${label}: ${raw}`);
    // PostgreSQL quoted identifiers can contain spaces, hyphens, mixed case, and Unicode.
    // Reject only characters that are unsafe or operationally ambiguous for config-driven identifiers.
    if (/[\u0000-\u001F\u007F]/.test(part)) throw new Error(`Unsafe control character in ${label}: ${raw}`);
  }
  return raw;
}

export function quoteSqlIdentifier(identifier, label = "identifier") {
  const raw = String(identifier || "").trim();
  if (!raw) throw new Error(`Missing ${label}.`);
  if (/[\u0000-\u001F\u007F]/.test(raw)) throw new Error(`Unsafe control character in ${label}: ${raw}`);
  // Standard PostgreSQL identifier quoting: embedded double quotes are escaped by doubling them.
  return `"${raw.replace(/"/g, '""')}"`;
}

export function quoteIdentifierPath(value, label = "table name") {
  const safe = assertSafeSqlIdentifierPath(value, label);
  return safe.split(".").map((part) => quoteSqlIdentifier(part, label)).join(".");
}
