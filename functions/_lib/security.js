const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_SCOPE = "admin";

export function normalizeEmail(value) {
  return String(value || "").toLowerCase().replace(/\s/g, "").trim();
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

export function jsonResponseCacheable(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      "cache-control": "no-cache, s-maxage=15",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}


export function requireDebugToken(request, env = {}) {
  const expected = String(env.DEBUG_TOKEN || "").trim();
  if (!expected) {
    return { ok: true, configured: false };
  }
  const url = new URL(request.url);
  const provided = String(
    request.headers.get("x-debug-token") ||
    request.headers.get("x-pd-debug-token") ||
    url.searchParams.get("debugToken") ||
    ""
  ).trim();

  if (!provided || provided !== expected) {
    return {
      ok: false,
      configured: true,
      response: jsonResponse({
        success: false,
        error: "Unauthorized debug request."
      }, 401)
    };
  }

  return { ok: true, configured: true };
}

export async function readJson(request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "Invalid payload. Expected a JSON object." };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: "Invalid JSON body." };
  }
}

export async function issueSessionToken(email, env = {}, scope = "client") {
  const cleanEmail = normalizeEmail(email);
  const safeScope = ["client", "trainee", "admin", "all"].includes(String(scope || "").toLowerCase()) ? String(scope).toLowerCase() : "client";
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  const payload = {
    v: 1,
    email: cleanEmail,
    scope: safeScope,
    iat: now,
    exp: now + ttl
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encodedPayload, env);

  return {
    token: `v1.${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    expiresInSeconds: ttl,
    session: payload
  };
}

export async function requireSessionScope(request, env = {}, allowedScopes = ["client"]) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Unauthorized. Missing Bearer session token."
      }, 401)
    };
  }

  const verified = await verifySessionToken(token, env);
  if (!verified.ok) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: verified.error || "Unauthorized. Invalid session token."
      }, 401)
    };
  }

  const allowed = new Set([...(allowedScopes || []), "all"]);
  if (!allowed.has(verified.session.scope)) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Forbidden. Invalid session scope."
      }, 403)
    };
  }

  return { ok: true, session: verified.session };
}

export async function requireClientSession(request, env = {}) {
  return requireSessionScope(request, env, ["client"]);
}

export async function requireTraineeSession(request, env = {}) {
  return requireSessionScope(request, env, ["trainee"]);
}

export async function requireAdminSession(request, env = {}) {
  return requireSessionScope(request, env, [ADMIN_SCOPE]);
}

export function getAdminEmails(env = {}) {
  return String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(/[;,\n]/)
    .map(normalizeEmail)
    .filter(Boolean);
}

export function isAdminEmail(email, env = {}) {
  const clean = normalizeEmail(email);
  if (!clean) return false;
  const allowed = getAdminEmails(env);
  return allowed.includes(clean);
}

export async function requireAdminOrDebug(request, env = {}) {
  const debugAuth = requireDebugToken(request, env);
  if (debugAuth.ok && debugAuth.configured) {
    return { ok: true, method: "debug-token" };
  }

  const adminAuth = await requireAdminSession(request, env);
  if (adminAuth.ok) {
    if (!isAdminEmail(adminAuth.session.email, env)) {
      return {
        ok: false,
        response: jsonResponse({ success: false, error: "Forbidden. Admin email is not allowed." }, 403)
      };
    }
    return { ok: true, method: "admin-session", session: adminAuth.session };
  }

  if (env.DEBUG_TOKEN) return debugAuth;
  return adminAuth;
}

export function assertEmailAllowed(requestedEmail, sessionEmail) {
  const requested = normalizeEmail(requestedEmail);
  const session = normalizeEmail(sessionEmail);

  if (!requested) return { ok: true, email: session };
  if (requested !== session) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Forbidden. Requested email does not match the authenticated session."
      }, 403)
    };
  }
  return { ok: true, email: session };
}

async function verifySessionToken(token, env = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, error: "Unauthorized. Malformed session token." };
  }

  const encodedPayload = parts[1];
  const providedSignature = parts[2];
  const expectedSignature = await sign(encodedPayload, env);

  if (providedSignature !== expectedSignature) {
    return { ok: false, error: "Unauthorized. Invalid session signature." };
  }

  let session;
  try {
    session = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (err) {
    return { ok: false, error: "Unauthorized. Invalid session payload." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!session.email || !session.exp || session.exp < now) {
    return { ok: false, error: "Unauthorized. Session expired." };
  }

  return { ok: true, session };
}

async function sign(value, env = {}) {
  const secret = String(env.API_SESSION_SECRET || "pd-onestop-dev-secret-change-me");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return arrayBufferToBase64Url(signature);
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
