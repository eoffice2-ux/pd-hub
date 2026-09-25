const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function getCoreSpreadsheetId(env = {}) {
  return String(env.GOOGLE_SHEET_ID_CORE || env.GOOGLE_SHEET_ID || "").trim();
}

export function getFeedbackSpreadsheetId(env = {}) {
  return String(env.GOOGLE_SHEET_ID_FEEDBACK || "").trim();
}

export function assertGoogleSheetsEnv(env = {}) {
  const missing = [];
  if (!env.GOOGLE_CLIENT_EMAIL) missing.push("GOOGLE_CLIENT_EMAIL");
  if (!env.GOOGLE_PRIVATE_KEY) missing.push("GOOGLE_PRIVATE_KEY");
  if (!getCoreSpreadsheetId(env)) missing.push("GOOGLE_SHEET_ID_CORE");
  return missing;
}

export async function getSheetValues(env, spreadsheetId, rangeA1, options = {}) {
  const bypassCache = options.bypassCache || false;
  const customTtl = options.ttl;
  const ttl = customTtl !== undefined ? Number(customTtl) : Number(env.SHEETS_CACHE_TTL_SECONDS ?? "3");
  const cacheKeyUrl = `https://pd-onestop.pages.dev/.cache/sheets/${encodeURIComponent(spreadsheetId)}/${encodeURIComponent(rangeA1)}`;

  let cache;
  if (ttl > 0 && !bypassCache) {
    try {
      if (typeof caches !== "undefined" && caches.default) {
        cache = caches.default;
      }
    } catch (e) {}
  }

  if (cache) {
    try {
      const cachedResponse = await cache.match(cacheKeyUrl);
      if (cachedResponse) {
        const cachedJson = await cachedResponse.json().catch(() => null);
        if (cachedJson) {
          return cachedJson;
        }
      }
    } catch (err) {
      // Fallback to fetch on cache match error
    }
  }

  const token = await getGoogleAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google Sheets values.get failed with status ${res.status}`);
  }

  if (ttl > 0) {
    try {
      if (typeof caches !== "undefined" && caches.default) {
        const cacheResponse = new Response(JSON.stringify(json), {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttl}`
          }
        });
        await caches.default.put(cacheKeyUrl, cacheResponse);
      }
    } catch (err) {
      // Ignore cache put errors
    }
  }

  return json;
}


export async function batchUpdateSheetValues(env, spreadsheetId, data, valueInputOption = "USER_ENTERED") {
  const token = await getGoogleAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      valueInputOption,
      data
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google Sheets values.batchUpdate failed with status ${res.status}`);
  }
  return json;
}

export function columnNumberToLetter(columnNumber) {
  let n = Number(columnNumber);
  if (!Number.isInteger(n) || n < 1) throw new Error("Invalid column number.");
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function makeCellRange(sheetName, rowNumber, columnNumber) {
  return `${quoteSheetName(sheetName)}!${columnNumberToLetter(columnNumber)}${rowNumber}`;
}

export async function getSpreadsheetMetadata(env, spreadsheetId) {
  const token = await getGoogleAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties.title,sheets.properties.gridProperties.rowCount,sheets.properties.gridProperties.columnCount`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google Sheets spreadsheets.get failed with status ${res.status}`);
  }
  return json;
}

export function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

async function getGoogleAccessToken(env = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: String(env.GOOGLE_CLIENT_EMAIL || "").trim(),
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  if (!payload.iss) throw new Error("Missing GOOGLE_CLIENT_EMAIL.");
  if (!env.GOOGLE_PRIVATE_KEY) throw new Error("Missing GOOGLE_PRIVATE_KEY.");

  const unsignedJwt = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await signRs256(unsignedJwt, env.GOOGLE_PRIVATE_KEY);
  const assertion = `${unsignedJwt}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || `Google token request failed with status ${res.status}`);
  }
  return json.access_token;
}

async function signRs256(value, privateKeyPem) {
  const keyData = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(value)
  );
  return arrayBufferToBase64Url(signature);
}

function pemToArrayBuffer(pem) {
  const normalizedPem = normalizePrivateKeyPem(pem);

  let base64 = normalizedPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  // Some copy/paste flows accidentally convert base64url chars. Normalize them.
  base64 = base64.replace(/-/g, "+").replace(/_/g, "/");

  if (!base64) {
    throw new Error("GOOGLE_PRIVATE_KEY is empty after PEM normalization. Check the Cloudflare secret value.");
  }

  if (/[^A-Za-z0-9+/=]/.test(base64)) {
    throw new Error("GOOGLE_PRIVATE_KEY contains invalid base64 characters after PEM normalization. Re-copy only the private_key value, without JSON field name, comma, or extra quotes.");
  }

  const remainder = base64.length % 4;
  if (remainder === 1) {
    throw new Error("GOOGLE_PRIVATE_KEY base64 length is invalid. The key is likely truncated or copied incorrectly.");
  }
  if (remainder > 0) base64 += "=".repeat(4 - remainder);

  let binary;
  try {
    binary = atob(base64);
  } catch (err) {
    throw new Error("Unable to decode GOOGLE_PRIVATE_KEY. Re-copy the private_key from the service account JSON, including BEGIN/END PRIVATE KEY lines.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function normalizePrivateKeyPem(value) {
  let pem = String(value || "").trim();

  // If the secret was pasted as a JSON string including surrounding double quotes, decode it.
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    if (pem.startsWith('"')) {
      try {
        pem = JSON.parse(pem);
      } catch {
        pem = pem.slice(1, -1);
      }
    } else {
      pem = pem.slice(1, -1);
    }
  }

  // Support both real newlines and literal \n sequences copied from JSON.
  pem = pem
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  return pem;
}

function base64UrlEncodeJson(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function arrayBufferToBase64Url(buffer) {
  return base64UrlEncode(new Uint8Array(buffer));
}

export async function appendSheetValues(env, spreadsheetId, rangeA1, values, valueInputOption = "USER_ENTERED") {
  const token = await getGoogleAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=${encodeURIComponent(valueInputOption)}&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ values })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Google Sheets values.append failed with status ${res.status}`);
  }
  return json;
}
