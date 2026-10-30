# PD One-Stop Hub — Project Handoff & Continuation Guide

> **Purpose:** This document is the single source of truth for transitioning development into a new chat session or onboarding new developers. It summarizes the exact system state, active branch, deployed architecture, API endpoints, and recent enhancements.

---

## 1. System Identity & Environment

| Property | Value |
|---|---|
| **Project Name** | EIU Professional Development One-Stop Hub (PD Hub) |
| **Active Codebase Path** | `d:\Google Antigravity\PD Onestop\3. Cloudflare PDHub\step 44 - Production Stable` |
| **Git Repository** | `https://github.com/eoffice2-ux/pd-hub.git` |
| **Active Branch** | `main` (synchronized with `origin/main`) |
| **Live Production URL** | **[https://pd-onestop.pages.dev](https://pd-onestop.pages.dev)** |
| **Hosting Platform** | Cloudflare Pages + Pages Functions (`nodejs_compat` enabled) |
| **Primary Relational DB** | PostgreSQL via Cloudflare Hyperdrive pool (`env.HYPERDRIVE`) |
| **Fallback / Secondary DB** | Google Sheets API v4 (Strictly ignored when table source is `psql`; all new tables target PostgreSQL exclusively) |
| **Transactional Email** | Dual-GAS (`GAS1` / `GAS2`) + Brevo REST API v3 rotation |
| **Federated Authentication** | Google Identity Services + Microsoft 365 Entra ID (`common` multi-tenant) with universal account support |

---

## 2. Portals & User Roles

The application is deployed as a single Cloudflare Pages project with unified edge routing:

### 🎓 1. Trainee Portal (`/trainee` &rarr; `public/trainee/index.html`)
- **Authentication**: 4-digit PIN (text format preserving leading zeros) or 6-digit Email OTP via Brevo/GAS.
- **Lookup Hardening**: Case-insensitive and whitespace-trimmed email lookup; concurrent active OTPs across multiple tabs/devices.
- **Course Catalog & Registration**: Dynamic seat meter, instant capacity locking, `.ics` calendar invitation dispatch via AppSheet webhook.
- **In-Class Check-in**: 6-digit code entry with strict server-side start/end time window validation.
- **Feedback & Surveys**: Dynamic multi-round survey form completion.
- **Organization Autocomplete & Declaration**:
  - Trainees select their company from master list or declare unlisted entities (`POST /api/trainee/organizations/register-pending`).
  - Unapproved organizations display a dynamic "Pending PD" badge in autocomplete.

### 🏢 2. Corporate Client Portal (`/client` &rarr; `public/client/index.html`)
- **Authentication**: Passwordless Email OTP.
- **Corporate Profile**: PostgreSQL-backed client contract profile (`pdc_client_contract_info`).
- **Inquiry Pipeline**: Training inquiry tracking, requirement submissions, and status updates.

### 📊 3. Executive Report Portal (`/report` &rarr; `public/report.html`)
- **Authorization**: Role `admin` or `report_viewer` in `pdc_user_roles`.
- **Operational Grid**: Course metrics, attendance rates, check-in completion, and feedback percentages.
- **Interactive Class Detail Modal ("Report" Tab)**:
  - **KPI Cards**: Registered count, Check-in completion rate, Survey completion rate, Average rating out of 5 stars.
  - **Attendance Breakdown**: Donut chart with total present/absent/upcoming and per-slot progress bars.
  - **Survey Participation Breakdown**: Donut chart with total submitted/missed/upcoming and per-round progress bars.
  - **Question-by-Question Survey Results**:
    - **Single Choice (`radio`)**: SVG donut/pie chart with percentages and respondent counts.
    - **Multiple Choice (`checkbox`)**: Horizontal percentage progress bars calculated against total respondents who answered the question.
    - **Rating Scale (`scale`)**: Dynamic 1..5 star range detection (handles `"1; 2; 3; 4; 5"`, `"1-5"`, labels), star tier pie chart, average score badge (`⭐ Điểm TB: X / 5`).
    - **Net Promoter Score (`nps`)**: Promoters (9–10), Passives (7–8), Detractors (0–6), overall NPS score ($\% \text{Promoters} - \% \text{Detractors}$), average rating, and 0–10 score chips.
    - **Text Feedback (`text`, `short_text`, `long_text` & Unknown types)**: Collapsible quotes with toggleable trainee email.
  - **Data Privacy**: Trainee emails hidden by default; revealing emails (switch, print, CSV export) automatically triggers audit logging (`report_feedback_email_viewed`).
  - **Export & Print**: Clean A4 print layout via isolated iframe; one-click CSV export.

### 🛡️ 4. Admin & Developer Hub (`/admin` &rarr; `public/admin/index.html`)
- **Authorization**: Role `admin` in `pdc_user_roles` or `ADMIN_EMAILS` list.
- **System Diagnostics**: Hyperdrive latency, PostgreSQL pool health, Google Sheets quota checks, edge cache status.
- **Pending Organizations Review**: Interface to review, approve, reject, or edit English company names for pending organizations.
- **Role-Based Access Control**: Assign or revoke `admin` and `report_viewer` roles.
- **Operational Audit Logs**: Categorized into 4 scopes (`auth`, `trainee`, `client`, `admin`) with scope filter, live search, IP address, and email provider columns.
- **Interactive Developer Docs**: Markdown-rendered documentation from `public/docs/*.md`.

---

## 3. Backend Architecture & API Routes

All serverless endpoints run under `functions/api/`:

### Authentication & Sessions
- `POST /api/auth/send-otp`: Dispatches 6-digit OTP code to trainee/client/admin email.
- `POST /api/auth/verify-otp`: Validates OTP and issues signed session token.
- `POST /api/auth/verify-pin`: Validates trainee 4-digit PIN and issues session token.
- `POST /api/auth/set-pin`: Sets or updates 4-digit PIN.
- `GET /api/auth/access-type`: Returns user classification (`eiu`, `industry`, `unknown`).

### Trainee Services
- `GET /api/trainee/profile` & `POST /api/trainee/profile/update`: Read/update profile.
- `GET /api/trainee/sections`: Enumerate course catalog.
- `GET /api/trainee/active-sections`: Enrolled classes.
- `GET /api/trainee/section/details`: Class detail modal information.
- `POST /api/trainee/register`: Atomic course enrollment.
- `GET /api/trainee/history`: Historical courses and feedback status.
- `GET /api/trainee/checkin/data` & `POST /api/trainee/checkin/submit`: Verify and commit attendance.
- `GET /api/trainee/forms`: Feedback forms mapped to active section.
- `GET /api/trainee/forms/questions`: Survey questions list.
- `POST /api/trainee/forms/submit`: Commit survey answers.
- `GET /api/trainee/organizations/search`: Autocomplete organizations with PD badge.
- `POST /api/trainee/organizations/register-pending`: Self-declare unlisted organization.
- `GET /api/trainee/schools` & `GET /api/trainee/programs`: EIU academic dropdowns.

### Client Services
- `GET /api/client/profile` & `POST /api/client/profile/update`: Corporate client profile.
- `GET /api/client/inquiries` & `POST /api/client/inquiry/update`: Training inquiry pipeline.

### Report & Analytics Services
- `GET /api/report/report-data`: Master section attendance, check-in, and feedback metrics.
- `GET /api/report/feedback-summary`: Aggregated feedback survey metrics per round, question types, distributions, and quotes.
- `POST /api/report/log-email-view`: Logs `report_feedback_email_viewed` audit event when respondent emails are revealed.

### Admin Services
- `GET /api/admin/status`: System diagnostics and operational logs (`pdc_app_logs`).
- `GET`, `POST`, `DELETE /api/admin/roles`: RBAC management (`pdc_user_roles`).
- `GET`, `POST`, `PATCH /api/admin/pending-orgs`: Pending organization review and approval.
- `POST /api/admin/migrate-final-tables`: Data synchronization utility for PostgreSQL migration.

---

## 4. Key Chronological Milestones (Steps 47–51)

1. **Step 47 — Final PostgreSQL Migration** (Commit `868969f`, `a640cc3`, `44bcc10`, `dd5f329`):
   - Migrated `pdc_course master list`, `pdc_client_contract_info`, and system setting tables to PostgreSQL public schema.
2. **Step 48 — Trainee Pending Organizations & Admin Review** (Commit `96fd606`, `73c528b`, `2ebe40e`, `46c1e30`):
   - Enabled trainee pending organization declaration with "Pending PD" badge.
   - Built Admin review panel with English company name editing and status management (`approved`, `rejected`, `merged`).
3. **Step 49 — Authentication & Registration Hardening** (Commit `023f99f`):
   - Implemented case-insensitive & whitespace-trimmed email lookup.
   - Enabled concurrent multi-tab OTP validation.
4. **Step 50 — Comprehensive Operational Audit Logs** (Commit `5694d6b`, `53ee764`, `8e33151`):
   - Scope categorization (`auth`, `trainee`, `client`, `admin`), IP and email provider tracking, live search, and DOM null checks.
5. **Step 51 — Executive Class Detail Report Tab & Survey Analytics** (Commit `06c718b`, `570a266`, `78af549`):
   - Added interactive "Report" tab to Class Detail modal in `/report.html`.
   - Attendance summary, survey participation overview, and question-by-question analytics.
   - Question type support: `radio` (pie), `checkbox` (horizontal percent bars), `scale` (1..5 stars with dynamic range detection), `nps` (Promoters/Passives/Detractors + NPS score), and `text` (quotes with toggleable email).
   - Email reveal operational audit logging (`report_feedback_email_viewed`).
   - Fixed scale range parsing bug where semicolon-delimited lists (`"1; 2; 3; 4; 5"`) were incorrectly truncated to max 2.
6. **Step 52 — Trainee Organization Disambiguation & First-Login Guardrails** (Commit `39fb85e`, `0546ade`):
   - Implemented interactive Disambiguation Modal card intercepting custom-typed org names when database matches exist.
   - Fuzzy corporate token matching via `stripOrgNoiseWords` across `name_vn` and `name_gb`.
   - Visual status pill indicating verified database selection vs pending manual declaration.
   - Welcoming first-login onboarding guidance alert.
7. **Step 53 — Section Status ('Registration Ready') & Type ('community') Expansion**:
   - Expanded catalog visibility to include `section status = "Registration Ready"` (case-insensitive).
   - Strict date-window gating for registration:
     - `now < start_reg`: Dynamic informative cyan badge `"Upcoming • Opens dd/mmm/yyyy"` (e.g. `Upcoming • Opens 25/Oct/2026`) in `bg-info text-dark`, card non-clickable/disabled.
     - `start_reg <= now <= end_reg`: Dynamically displays `"Open for registration"` (`bg-success`), enabling enrollment.
     - `now > end_reg`: Dynamically displays `"Missed"` (`bg-danger`), non-clickable.
   - Expanded `section type = "community"` (case-insensitive) to be visible to and registrable by all `userType` (`Industry`, `Staff`, `Student`) across both PostgreSQL repository (`section-repo.js`, `registration-repo.js`) and Google Sheets fallback (`trainee-gsheet.js`).

---

8. **Step 54 — Federated OAuth (Google & Microsoft) & Multi-Role RBAC**:
   - Integrated Google & Microsoft OAuth login buttons across all portals (`/trainee`, `/client`, `/report.html`, `/admin`).
   - Dynamic OAuth redirect URI generator supporting both `https://pd-onestop.pages.dev` and custom production domain `https://pd-onestop.centralhub.io.vn`.
   - In-Admin OAuth credentials manager (`OAuth Settings` tab) backed by `pdc_system_settings`.
   - Automatic zero-friction default role (`trainee`) for first-time OAuth users.
   - Introduced `super_user` role: only `super_user` or `ADMIN_EMAILS` can assign roles or modify OAuth configurations.
   - Multi-role support: users can hold multiple roles simultaneously (`trainee`, `client`, `report_viewer`, `admin`, `super_user`).
   - Added interactive `portal-switcher.js` providing an elegant top-header dropdown to jump between active portals without re-authenticating.

---

## 5. Verification Runbook & Testing Commands

To run the automated test suite across all portals:

```powershell
# In '3. Cloudflare PDHub/step 44 - Production Stable':

# 1. Test OAuth Multi-Domain & Multi-Role RBAC
node test-oauth-multirole.mjs

# 2. Test Section Status ('Registration Ready') & Type ('community') Expansion
node test-section-status-type-expansion.mjs

# 3. Test Trainee Organization Disambiguation & Profile First-Login
node test-trainee-profile-org-disambig.mjs

# 4. Audit DOM ID null-safety across all HTML pages
node audit-dom-ids.mjs

# 5. Test Class Detail Report Tab, Question Types, and Email Reveal Audit
node test-class-report-tab.mjs

# 6. Test Operational Logs enhancements and scope filters
node test-operational-logs-enhancements.mjs

# 7. Test Registration and OTP Fixes
node test-registration-otp-fixes.mjs
```

---

## 6. Deployment Guide

To deploy updates to Cloudflare Pages:

```powershell
cd "d:\Google Antigravity\PD Onestop\3. Cloudflare PDHub\step 44 - Production Stable"

# Deploy to Cloudflare Pages production branch
npx wrangler pages deploy public --branch production
```

Verify deployment status:
- Production URL: `https://pd-onestop.pages.dev`
- Verification endpoint: `https://pd-onestop.pages.dev/api/health`
