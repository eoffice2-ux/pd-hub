import { jsonResponse, normalizeEmail, requireAdminOrDebug } from "../../_lib/security.js";
import { getCoreSpreadsheetId, getSheetValues, quoteSheetName } from "../../_lib/google-sheets.js";
import { queryPostgres } from "../../_lib/postgres.js";

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS public.temp_otp (
    "email" VARCHAR(255) NOT NULL,
    "otp_hash" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "used_at" TIMESTAMP WITH TIME ZONE,
    "send_provider" VARCHAR(50),
    "request_ip" VARCHAR(100),
    "user_agent" TEXT,
    PRIMARY KEY ("email", "scope")
  );`,

  `CREATE TABLE IF NOT EXISTS public.pdc_app_logs (
    "id" SERIAL PRIMARY KEY,
    "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "event" VARCHAR(255),
    "scope" VARCHAR(100),
    "email" VARCHAR(255),
    "path" TEXT,
    "success" VARCHAR(10),
    "provider" VARCHAR(100),
    "message_id" TEXT,
    "detail" TEXT,
    "ip" VARCHAR(100),
    "user_agent" TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS public.pdc_user_roles (
    "email" VARCHAR(255) PRIMARY KEY,
    "role" VARCHAR(50),
    "assigned_by" VARCHAR(255),
    "assigned_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "pin number" VARCHAR(20)
  );`,

  `CREATE TABLE IF NOT EXISTS public.pdc_client_contract_info (
    "client id" VARCHAR(100) PRIMARY KEY,
    "client updater email" VARCHAR(255),
    "client name vn" VARCHAR(255),
    "client name en" VARCHAR(255),
    "client address vn" TEXT,
    "client address en" TEXT,
    "tax code" VARCHAR(50),
    "client phone number" VARCHAR(50),
    "representative name vn" VARCHAR(255),
    "representative name en" VARCHAR(255),
    "representative position vn" VARCHAR(255),
    "representative position en" VARCHAR(255),
    "updated at" VARCHAR(100),
    "updated by" VARCHAR(255)
  );`,

  `CREATE TABLE IF NOT EXISTS public."pdc_course master list" (
    "course id" VARCHAR(100) PRIMARY KEY,
    "course name" VARCHAR(255),
    "course name en" VARCHAR(255),
    "course name vn" VARCHAR(255),
    "course objectives" TEXT,
    "course description" TEXT
  );`
];

export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const debugAuth = requireDebugToken(context.request, env);
  const providedToken = String(url.searchParams.get("token") || url.searchParams.get("debugToken") || "").trim();
  const expectedToken = String(env.DEBUG_TOKEN || "").trim();

  let authorized = false;
  if (!expectedToken || (providedToken && providedToken === expectedToken) || (debugAuth.ok && debugAuth.configured)) {
    authorized = true;
  } else {
    const auth = await requireAdminOrDebug(context.request, env);
    if (auth.ok) authorized = true;
  }

  if (!authorized) {
    return jsonResponse({ success: false, error: "Unauthorized. Provide debugToken or log in as admin." }, 401);
  }

  const shouldInitSchema = ["1", "true", "yes"].includes(String(url.searchParams.get("initSchema") || "").toLowerCase());
  const spreadsheetId = getCoreSpreadsheetId(env);

  const report = {
    success: true,
    timestamp: new Date().toISOString(),
    schemaInitialized: false,
    schemaErrors: [],
    tables: {}
  };

  // Optional schema initialization
  if (shouldInitSchema) {
    for (const ddl of DDL_STATEMENTS) {
      try {
        await queryPostgres(env, ddl);
      } catch (err) {
        report.schemaErrors.push(err.message || String(err));
      }
    }
    report.schemaInitialized = report.schemaErrors.length === 0;
  }

  if (!spreadsheetId) {
    return jsonResponse({
      ...report,
      success: false,
      error: "Missing GOOGLE_SHEET_ID_CORE environment variable."
    }, 500);
  }

  // 1. Migrate pdc_user_roles
  report.tables.user_roles = await migrateUserRoles(env, spreadsheetId);

  // 2. Migrate pdc_client_contract_info
  report.tables.client_contract_info = await migrateClientContracts(env, spreadsheetId);

  // 3. Migrate pdc_course master list
  report.tables.course_master = await migrateCourseMaster(env, spreadsheetId);

  // 4. Migrate pdc_app_logs (recent logs)
  report.tables.app_logs = await migrateAppLogs(env, spreadsheetId);

  // 5. Migrate temp_otp (active unexpired OTPs)
  report.tables.temp_otp = await migrateTempOtp(env, spreadsheetId);

  return jsonResponse(report, 200);
}

async function migrateUserRoles(env, spreadsheetId) {
  const result = { sheet: "pdc_user_roles", totalRows: 0, transferred: 0, errors: [] };
  try {
    const range = `${quoteSheetName("pdc_user_roles")}!A:E`;
    const res = await getSheetValues(env, spreadsheetId, range);
    const values = res.values || [];
    if (values.length < 2) return result;

    const headers = values[0].map(h => String(h || "").trim().toLowerCase());
    const emailIdx = headers.indexOf("email");
    const roleIdx = headers.indexOf("role");
    const assignedByIdx = headers.indexOf("assigned_by");
    const assignedAtIdx = headers.indexOf("assigned_at");
    const pinIdx = headers.indexOf("pin number") !== -1 ? headers.indexOf("pin number") : headers.indexOf("pin");

    result.totalRows = values.length - 1;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const email = emailIdx !== -1 ? normalizeEmail(row[emailIdx]) : "";
      if (!email) continue;
      const role = roleIdx !== -1 ? String(row[roleIdx] || "").trim().toLowerCase() : "client";
      const assignedBy = assignedByIdx !== -1 ? String(row[assignedByIdx] || "") : "";
      const pin = pinIdx !== -1 ? String(row[pinIdx] || "").trim() : "";

      const sql = `
        INSERT INTO public.pdc_user_roles ("email", "role", "assigned_by", "assigned_at", "pin number")
        VALUES ($1, $2, $3, NOW(), $4)
        ON CONFLICT ("email") DO UPDATE SET
          "role" = EXCLUDED."role",
          "assigned_by" = EXCLUDED."assigned_by",
          "pin number" = COALESCE(NULLIF(EXCLUDED."pin number", ''), public.pdc_user_roles."pin number")
      `;
      try {
        await queryPostgres(env, sql, [email, role, assignedBy, pin]);
        result.transferred++;
      } catch (err) {
        result.errors.push({ email, error: err.message || String(err) });
      }
    }
  } catch (err) {
    result.errors.push({ general: err.message || String(err) });
  }
  return result;
}

async function migrateClientContracts(env, spreadsheetId) {
  const result = { sheet: "pdc_client_contract_info", totalRows: 0, transferred: 0, errors: [] };
  try {
    const range = `${quoteSheetName("pdc_client_contract_info")}!A:ZZ`;
    const res = await getSheetValues(env, spreadsheetId, range);
    const values = res.values || [];
    if (values.length < 2) return result;

    const headers = values[0].map(h => String(h || "").trim().toLowerCase());
    const clientIdIdx = headers.indexOf("client id");
    if (clientIdIdx === -1) {
      result.errors.push({ general: "Missing 'client id' column." });
      return result;
    }

    result.totalRows = values.length - 1;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const clientId = String(row[clientIdIdx] || "").trim();
      if (!clientId) continue;

      const getVal = (col) => {
        const idx = headers.indexOf(col);
        return idx !== -1 ? String(row[idx] ?? "").trim() : "";
      };

      const sql = `
        INSERT INTO public.pdc_client_contract_info (
          "client id", "client updater email", "client name vn", "client name en",
          "client address vn", "client address en", "tax code", "client phone number",
          "representative name vn", "representative name en", "representative position vn",
          "representative position en", "updated at", "updated by"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT ("client id") DO UPDATE SET
          "client updater email" = EXCLUDED."client updater email",
          "client name vn" = EXCLUDED."client name vn",
          "client name en" = EXCLUDED."client name en",
          "client address vn" = EXCLUDED."client address vn",
          "client address en" = EXCLUDED."client address en",
          "tax code" = EXCLUDED."tax code",
          "client phone number" = EXCLUDED."client phone number",
          "representative name vn" = EXCLUDED."representative name vn",
          "representative name en" = EXCLUDED."representative name en",
          "representative position vn" = EXCLUDED."representative position vn",
          "representative position en" = EXCLUDED."representative position en",
          "updated at" = EXCLUDED."updated at",
          "updated by" = EXCLUDED."updated by"
      `;

      const params = [
        clientId,
        normalizeEmail(getVal("client updater email")),
        getVal("client name vn"),
        getVal("client name en"),
        getVal("client address vn"),
        getVal("client address en"),
        getVal("tax code"),
        getVal("client phone number"),
        getVal("representative name vn"),
        getVal("representative name en"),
        getVal("representative position vn"),
        getVal("representative position en"),
        getVal("updated at"),
        getVal("updated by")
      ];

      try {
        await queryPostgres(env, sql, params);
        result.transferred++;
      } catch (err) {
        result.errors.push({ clientId, error: err.message || String(err) });
      }
    }
  } catch (err) {
    result.errors.push({ general: err.message || String(err) });
  }
  return result;
}

async function migrateCourseMaster(env, spreadsheetId) {
  const result = { sheet: "pdc_course master list", totalRows: 0, transferred: 0, errors: [] };
  try {
    const range = `${quoteSheetName("pdc_course master list")}!A:ZZ`;
    const res = await getSheetValues(env, spreadsheetId, range);
    const values = res.values || [];
    if (values.length < 2) return result;

    const headers = values[0].map(h => String(h || "").trim().toLowerCase());
    const courseIdIdx = headers.indexOf("course id");
    if (courseIdIdx === -1) {
      result.errors.push({ general: "Missing 'course id' column." });
      return result;
    }

    result.totalRows = values.length - 1;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const courseId = String(row[courseIdIdx] || "").trim();
      if (!courseId) continue;

      const getVal = (col) => {
        const idx = headers.indexOf(col);
        return idx !== -1 ? String(row[idx] ?? "").trim() : "";
      };

      const courseName = getVal("course name") || getVal("course name en") || courseId;
      const courseNameEn = getVal("course name en") || courseName;
      const courseNameVn = getVal("course name vn") || getVal("course name");
      const courseObjectives = getVal("course objectives");
      const courseDesc = getVal("course description") || getVal("description") || getVal("course overview");

      const sql = `
        INSERT INTO public."pdc_course master list" (
          "course id", "course name", "course name en", "course name vn", "course objectives", "course description"
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("course id") DO UPDATE SET
          "course name" = EXCLUDED."course name",
          "course name en" = EXCLUDED."course name en",
          "course name vn" = EXCLUDED."course name vn",
          "course objectives" = EXCLUDED."course objectives",
          "course description" = EXCLUDED."course description"
      `;

      try {
        await queryPostgres(env, sql, [courseId, courseName, courseNameEn, courseNameVn, courseObjectives, courseDesc]);
        result.transferred++;
      } catch (err) {
        result.errors.push({ courseId, error: err.message || String(err) });
      }
    }
  } catch (err) {
    result.errors.push({ general: err.message || String(err) });
  }
  return result;
}

async function migrateAppLogs(env, spreadsheetId) {
  const result = { sheet: "pdc_app_logs", totalRows: 0, transferred: 0, errors: [] };
  try {
    const range = `${quoteSheetName("pdc_app_logs")}!A:K`;
    const res = await getSheetValues(env, spreadsheetId, range);
    const values = res.values || [];
    if (values.length < 2) return result;

    const headers = values[0].map(h => String(h || "").trim().toLowerCase().replace(/\s+/g, "_"));
    result.totalRows = values.length - 1;

    // Migrate last 200 logs
    const startIdx = Math.max(1, values.length - 200);
    for (let i = startIdx; i < values.length; i++) {
      const row = values[i] || [];
      const getVal = (col) => {
        const idx = headers.indexOf(col);
        return idx !== -1 ? String(row[idx] ?? "").trim() : "";
      };

      const sql = `
        INSERT INTO public.pdc_app_logs ("timestamp", "event", "scope", "email", "path", "success", "provider", "message_id", "detail", "ip", "user_agent")
        VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;

      try {
        await queryPostgres(env, sql, [
          getVal("event").slice(0, 80),
          getVal("scope").slice(0, 40),
          normalizeEmail(getVal("email")),
          getVal("path").slice(0, 300),
          getVal("success") || "TRUE",
          getVal("provider").slice(0, 80),
          getVal("message_id").slice(0, 160),
          getVal("detail").slice(0, 1000),
          getVal("ip").slice(0, 120),
          getVal("user_agent").slice(0, 400)
        ]);
        result.transferred++;
      } catch (err) {
        result.errors.push({ row: i, error: err.message || String(err) });
      }
    }
  } catch (err) {
    result.errors.push({ general: err.message || String(err) });
  }
  return result;
}

async function migrateTempOtp(env, spreadsheetId) {
  const result = { sheet: "temp_otp", totalRows: 0, transferred: 0, errors: [] };
  try {
    const range = `${quoteSheetName("temp_otp")}!A:I`;
    const res = await getSheetValues(env, spreadsheetId, range);
    const values = res.values || [];
    if (values.length < 2) return result;

    const headers = values[0].map(h => String(h || "").trim().toLowerCase().replace(/\s+/g, "_"));
    result.totalRows = values.length - 1;

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const getVal = (col) => {
        const idx = headers.indexOf(col);
        return idx !== -1 ? String(row[idx] ?? "").trim() : "";
      };

      const email = normalizeEmail(getVal("email"));
      const otpHash = getVal("otp_hash") || getVal("otp");
      const scope = getVal("scope") || "client";
      if (!email || !otpHash) continue;

      const sql = `
        INSERT INTO public.temp_otp ("email", "otp_hash", "scope", "created_at", "expires_at", "send_provider", "request_ip", "user_agent")
        VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '10 minutes', $4, $5, $6)
        ON CONFLICT ("email", "scope") DO NOTHING
      `;

      try {
        await queryPostgres(env, sql, [email, otpHash, scope, getVal("send_provider"), getVal("request_ip"), getVal("user_agent")]);
        result.transferred++;
      } catch (err) {
        result.errors.push({ email, error: err.message || String(err) });
      }
    }
  } catch (err) {
    result.errors.push({ general: err.message || String(err) });
  }
  return result;
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}
