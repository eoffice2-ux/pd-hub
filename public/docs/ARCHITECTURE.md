# Architecture & Data Flow

This document details the hybrid edge architecture of PD Hub. The system bridges modern low-latency serverless edge compute on Cloudflare with enterprise transactional storage (PostgreSQL) and legacy spreadsheet automation (Google Sheets / AppSheet).

---

## 1. High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph Clients["Clients & Portals"]
        TP["🎓 Trainee Portal\n(/trainee)"]
        CP["🏢 Client Portal\n(/client)"]
        RP["📊 Report App\n(/report)"]
        AP["🛡️ Admin Hub\n(/admin)"]
        AS["⚡ AppSheet Bot\n(Automations)"]
    end

    subgraph Edge["Cloudflare Edge Network"]
        CDN["Pages Static CDN\n(HTML, CSS, JS)"]
        FUN["Pages Functions API\n(/functions/api/*)"]
        CACHE["⚡ Sheets Edge Cache\n(3s TTL In-Memory)"]
        HYPER["⚡ Cloudflare Hyperdrive\n(TCP Connection Pool)"]
    end

    subgraph Storage["Data Tier"]
        PSQL[("🐘 PostgreSQL DB\n(Primary Transactional)")]
        GSHEET[("📑 Google Sheets API\n(Master / Fallback Core)")]
    end

    subgraph Services["External Integrations"]
        BREVO["✉️ Brevo API v3\n(Transactional OTP)"]
        GAS["🔄 Google Apps Script\n(Calendar Proxy)"]
    end

    TP --> CDN
    CP --> CDN
    RP --> CDN
    AP --> CDN

    TP --> FUN
    CP --> FUN
    RP --> FUN
    AP --> FUN
    AS --> FUN

    FUN --> BREVO
    FUN --> GAS
    FUN --> CACHE
    CACHE -.-> GSHEET
    FUN --> GSHEET
    FUN --> HYPER
    HYPER --> PSQL
```

---

## 2. Hybrid Data Source Routing Pattern

Every database table lookup dynamically checks whether PostgreSQL or Google Sheets should serve the request using the `functions/_lib/data-source.js` registry.

```mermaid
flowchart LR
    REQ["Incoming API Request"] --> RESOLVE{"isPsql(env, TABLE_KEY)?"}
    
    RESOLVE -- Yes (Default in Hybrid) --> HYPER["Query via Hyperdrive\n(Cloudflare Pool)"]
    HYPER --> PSQL["PostgreSQL Table\n(Fast SQL Query)"]
    PSQL --> RES["API JSON Response"]
    
    RESOLVE -- Fallback / GSheet Mode --> CACHE{"Check 3s\nEdge Cache"}
    CACHE -- Hit --> RES
    CACHE -- Miss --> API["Google Sheets API v4\n(JWT Service Account)"]
    API --> RES
```

### Table Source Determination Logic
1. **Global Default (`env.DB_MODE`):**
   - If `env.DB_MODE === 'psql'` (production default): Routes queries to PostgreSQL tables.
   - If `env.DB_MODE === 'gsheet'`: Routes queries to Google Sheets tabs.
2. **Per-Table Override (`TAB_<KEY>_SOURCE`):**
   - Individual tables can be independently toggled between sources via environment variables (e.g. `TAB_TRAINEE_PROFILE_SOURCE=psql`, `TAB_ORGANIZATION_SOURCE=psql`).
3. **Hyperdrive Binding (`env.HYPERDRIVE`):**
   - Provides edge connection pooling. If the Hyperdrive binding is unavailable (e.g. local preview), the adapter automatically falls back to direct `env.POSTGRES_CONNECTION_STRING` or Google Sheets.

---

## 3. High-Concurrency Mitigation: Sheets Edge Cache

When operating in Google Sheets fallback mode or reading sheets metadata, Google API has a strict quota of **300 requests per minute per project**.

```mermaid
sequenceDiagram
    autonumber
    actor Trainee as Trainee Browser
    participant Edge as Cloudflare Worker
    participant Cache as Memory Edge Cache
    participant Sheets as Google Sheets API

    Trainee->>Edge: GET /api/trainee/sections
    Edge->>Cache: Lookup "sections:master"
    alt Cache Hit (Age < 3s)
        Cache-->>Edge: Return Cached JSON
        Edge-->>Trainee: 200 OK (0ms DB Latency)
    else Cache Miss / Expired
        Edge->>Sheets: spreadsheets.values.get
        Sheets-->>Edge: Raw Cell Matrix
        Edge->>Cache: Store with 3s TTL
        Edge-->>Trainee: 200 OK
    end
```

### Write-Through Invalidation
To eliminate race conditions (such as double registration or check-in collisions):
- All write actions (e.g., `POST /api/trainee/register`, `POST /api/trainee/checkin/submit`) execute with **Cache-Bypass**.
- Upon a successful commit, the edge cache key for that entity is immediately purged or updated (Write-Through).

---

## 4. AppSheet Calendar Synchronization Flow

When class schedules change or registrations are cancelled via AppSheet, webhooks trigger real-time calendar updates via `.ics` attachments sent to trainees:

```mermaid
sequenceDiagram
    autonumber
    participant Admin as OCE Staff (AppSheet UI)
    participant Bot as AppSheet Webhook Bot
    participant Worker as Cloudflare Function
    participant DB as PostgreSQL
    participant GAS as Google Apps Script Proxy
    participant Mail as Trainee Inbox

    Admin->>Bot: Modify Section Date or Withdraw Trainee
    Bot->>Worker: POST /api/webhooks/appsheet/* (with X-AppSheet-Secret)
    Worker->>Worker: Validate Secret Header
    Worker->>DB: Query Attendees for Section
    DB-->>Worker: Attendee Emails & Details
    Worker->>Worker: Build iCalendar (.ics) with Dynamic SEQUENCE
    Worker->>GAS: Send Email with text/calendar MIME
    GAS->>Mail: Deliver Invite (.ics modifies personal calendar)
    Worker-->>Bot: 200 OK { success: true }
```
