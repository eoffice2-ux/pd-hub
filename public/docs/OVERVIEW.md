# PD Hub · System Overview

Welcome to the **EIU Professional Development Hub (PD Hub)** technical documentation. This platform provides digital services for corporate and individual training management, connecting the Office of Community Engagement (OCE), corporate partners, instructors, and trainees.

```
+-------------------------------------------------------------------------+
|                               PD HUB CORE                               |
|        Trainee Portal  *  Client Portal  *  Report App  *  Admin Hub    |
+-------------------------------------------------------------------------+
                                    |
                Cloudflare Pages & Pages Functions (Edge)
                                    |
        +---------------------------+---------------------------+
        |                                                       |
  Hyperdrive (Pool)                                     Google APIs
        |                                                       |
PostgreSQL Database                                    Google Sheets Core
(Primary Transactional)                                 (Master / Fallback)
```

---

## Portals & Core Modules

The application is deployed as a single Cloudflare Pages project with unified edge routing:

### 1. 🎓 Trainee Portal (`/trainee/index.html`)
- **Audience:** Internal EIU students/staff and external enterprise trainees.
- **Key Features:**
  - Dynamic login via **4-digit PIN** or **Email OTP** (auto-detects trainee type; case/space-insensitive lookup).
  - Profile self-service with EIU department/school cascading selectors or organization autocomplete.
  - **Pending Organization Declaration:** Trainees from unlisted companies can declare their organization name, automatically tagged with a dynamic "Pending PD" badge.
  - Interactive **Course Catalog** with real-time seat availability meter and section schedules.
  - Section enrollment with instantaneous seat locking and rejection upon capacity limits.
  - In-class **QR / 6-digit Check-in** with strict server-side start/end time window validation.
  - Learning history tracking and dynamic post-training **Feedback Form** submissions.

### 2. 🏢 Corporate Client Portal (`/client/index.html`)
- **Audience:** Enterprise HR managers, training coordinators, and corporate sponsors.
- **Key Features:**
  - Secure passwordless login via **Brevo Email OTP**.
  - Company Master Profile management stored in PostgreSQL (`pdc_client_contract_info`: tax code, legal addresses, authorized representatives).
  - Training Inquiries tracking & status updates (scope, requested timeline, budget, attendees).
  - Real-time synchronization with OCE business development pipeline.

### 3. 📊 Executive Report & Analytics (`/report.html`)
- **Audience:** OCE leadership, academic coordinators, and administrative officers.
- **Role Requirement:** `admin` or `report_viewer` assigned in `pdc_user_roles`.
- **Key Features:**
  - Unified operational dashboard cross-referencing attendance, check-ins, and feedback metrics.
  - Live section completion rates, enrollment statistics, and venue utilization.
  - **Class Detail Report Tab**:
    - **Header & Metrics**: Class metadata, registration/check-in/feedback rates, and timestamp in Vietnam ICT.
    - **Visual Participation Breakdown**: Donut charts with completion rates and drill-down progress bars for every check-in slot and survey round.
    - **Survey Results by Question**: Interactive feedback visualizer with dropdown survey round selector.
    - **Chart Engines**: SVG pie charts (`radio`), horizontal percentage bars (`checkbox`), NPS metrics with Promoters/Passives/Detractors distribution (`nps`), 1–5 star scale rating with dynamic min..max detection (`scale`), and text quotes with collapsible toggle.
    - **Data Privacy**: Trainee emails hidden by default with automated audit logging (`report_feedback_email_viewed`) upon user reveal.
    - **Export & Print**: Clean A4 print layout via isolated iframe and one-click CSV export.

### 4. 🛡️ Admin & Developer Hub (`/admin/index.html`)
- **Audience:** System engineers, devops, and authorized administrative staff.
- **Key Features:**
  - **Operational Status:** Deep health diagnostics for Hyperdrive, PostgreSQL pool, Google Sheets API, and edge cache.
  - **Pending Organizations Management:** Review, approve, reject, or merge newly declared organizations, and update English company names.
  - **RBAC Management:** Granular role assignment (`admin` vs `report_viewer`).
  - **Telemetry & Operational Logs:** Scope categorization (`auth`, `trainee`, `client`, `admin`), action types, IP address and email provider columns, live text search, and PostgreSQL execution traces.
  - **Interactive Developer Docs:** Real-time rendered documentation, architecture diagrams, and database matrix.

---

## Technical Stack

| Layer | Technology | Description |
|---|---|---|
| **Hosting & Edge** | Cloudflare Pages | Global edge static asset distribution + SSL |
| **Serverless Backend** | Cloudflare Pages Functions | Node.js-compatible serverless endpoints under `/functions/api` |
| **Primary Relational DB** | PostgreSQL | Hosted transactional database for 100% of master and transactional tables |
| **Connection Pooling** | Cloudflare Hyperdrive | Low-latency global TCP connection pooling to PostgreSQL |
| **Secondary / Sheet DB** | Google Sheets API v4 | Fallback data store accessed via Google Service Account (JWT) |
| **Email Delivery (OTP)** | Brevo API v3 (Sendinblue) + Dual-GAS | Transactional OTP email dispatch with automatic fallback |
| **Calendar Automation** | Google AppSheet + `.ics` | Webhook-triggered calendar invite updates and cancellations |
| **Design System** | OCE Design System | EIU brand identity (Deep Navy `#001A4E`, Gold `#C9A84C`, Warm Slate `#F8F7F5`) |
