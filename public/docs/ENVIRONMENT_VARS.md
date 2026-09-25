# Environment Variables & Wrangler Configuration

Configuration reference for Cloudflare Pages, Functions, bindings, and environment variables.

> [!WARNING]
> **Cloudflare Workers Free Tier Limit:**
> Cloudflare Workers strictly enforces a maximum limit of **64 total environment variables** (this combines both plaintext variables in `wrangler.toml` and encrypted secrets in the Cloudflare dashboard). Exceeding this limit causes `wrangler pages deploy` to fail with HTTP 400.

---

## 1. Minimalist Variable Architecture

To stay comfortably under the 64-variable limit, `functions/_lib/data-source.js` includes built-in defaults for all PostgreSQL and Google Sheets table names. 

**Rule for developers:** Do NOT define redundant `TAB_<KEY>_GSHEET` or `TAB_<KEY>_PSQL` in `wrangler.toml` unless you are explicitly overriding the default table name!

---

## 2. Plaintext Variables (`wrangler.toml [vars]`)

| Variable Name | Example / Default | Description |
|---|---|---|
| `DB_MODE` | `"psql"` | Master data source (`"psql"` for primary PostgreSQL, `"gsheet"` for Google Sheets). |
| `NODE_ENV` | `"production"` | Runtime environment. |
| `SHEET_EDGE_CACHE_TTL_MS`| `3000` | Edge cache duration (milliseconds) for Google Sheets API reads. |
| `STATIC_EDGE_CACHE_TTL_MS`| `30000` | Edge cache duration for master lists (courses, venues). |
| `GOOGLE_SHEET_ID_CORE` | `1eQ...` | Spreadsheet ID for Core business tabs (trainees, sections, registrations). |
| `GOOGLE_SHEET_ID_FEEDBACK`| `1fG...` | Spreadsheet ID for Feedback and survey responses. |
| `ADMIN_EMAILS` | `["admin@eiu.edu.vn"]` | Fallback comma-separated or JSON list of authorized system admins. |

### Per-Table Source Overrides (Optional)
If a specific table needs to run on Google Sheets while `DB_MODE="psql"`, specify:
```toml
TAB_CLIENT_PROFILE_SOURCE = "gsheet"
TAB_COURSE_MASTER_SOURCE = "gsheet"
```

---

## 3. Encrypted Secrets (Set via Cloudflare Dashboard / CLI)

Never commit secrets to Git. Configure these in **Cloudflare Pages &rarr; Settings &rarr; Environment variables**:

| Secret Name | Type | Description |
|---|---|---|
| `POSTGRES_CONNECTION_STRING` | Database URI | `postgres://user:password@host:5432/dbname?sslmode=require` |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON String | Google Cloud Service Account Private Key JSON with Sheets API permissions. |
| `BREVO_API_KEY` | API Key | Brevo v3 xkeysib API key for sending transactional OTP emails. |
| `BREVO_SENDER_EMAIL` | Email | Authorized sender email address (e.g. `oce@eiu.edu.vn`). |
| `APPSHEET_WEBHOOK_SECRET` | Token | Shared secret header validated on AppSheet webhooks. |
| `DEBUG_TOKEN` | Token | Emergency operational bypass token. |

---

## 4. Hyperdrive Binding

Hyperdrive accelerates database queries from Cloudflare Pages Functions to your PostgreSQL instance via connection pooling.

Configured in `wrangler.toml`:
```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<your-hyperdrive-config-id>"
```
In your code, access it via `context.env.HYPERDRIVE.connectionString`.
