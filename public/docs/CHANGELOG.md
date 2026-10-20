# Version Changes / Change Log

### **Step 51** — Executive Class Detail Report Tab & Survey Analytics
- **Class Detail Report Tab (`/report.html`)**:
  - Embedded dedicated "Report" tab directly inside the Class Detail modal with three primary analytics sections:
    1. **Course & Venue Header**: Class metadata, registration/check-in/feedback rates, and generated timestamp in Vietnam ICT.
    2. **Participation Overviews**: Donut charts with completion rates and drill-down progress bars for every check-in slot and survey round.
    3. **Survey Results by Question**: Interactive feedback visualizer supporting multi-round surveys via dropdown selector.
- **Survey Question Types & Visualizations**:
  - **Single Choice (`radio`)**: SVG donut/pie distribution chart with respondent counts and percentages.
  - **Multiple Choice (`checkbox`)**: Horizontal percentage progress bars calculated against total answered respondents (avoiding misleading multi-choice pies).
  - **Scale Rating (`scale`)**: Dynamic 1–5 star range parsing across semicolon lists (`1; 2; 3; 4; 5`, `1-5`), average score badge (`⭐ Điểm TB: X / 5`), and star tier distribution pie chart.
  - **Net Promoter Score (`nps`)**: Fixed 0–10 rating system computing Promoters (9–10), Passives (7–8), Detractors (0–6), overall **NPS Score** ($\% \text{Promoters} - \% \text{Detractors}$), average rating, and 0–10 score chips.
  - **Text Quotes (`text`, `short_text`, `long_text` & Unknown types)**: Structured feedback quote cards with collapsible view (> 10 items) and toggleable `(email)` format (hidden by default).
- **Data Privacy & Operational Audit Trail**:
  - Trainee emails are delivered server-side and hidden by default in the UI.
  - Whenever emails are revealed (via toggle switch, A4 print layout, or CSV export), an audit record is dispatched to `POST /api/report/log-email-view` and logged into `pdc_app_logs` under action `report_feedback_email_viewed` (scope `admin`).
- **Reporting Utilities**:
  - Print button generates a clean A4 formatted report using an isolated iframe.
  - One-click CSV export formats percentage questions and text feedback with optional email inclusion.

### **Step 50** — Comprehensive Operational Audit Logs
- **Scope Categorization**:
  - Reorganized `pdc_app_logs` across 4 distinct operational scopes: `auth`, `trainee`, `client`, and `admin`.
  - Added dedicated scope filter dropdown and live text search in the Admin portal (`/admin/index.html`).
- **Telemetry & Traceability**:
  - Logged client IP address (`cf-connecting-ip`) and active email provider.
  - Comprehensive action tracking: `trainee_login`, `client_login`, `admin_login`, `pin_changed`, `course_registered`, `attendance_checkin`, `feedback_submitted`, `org_declared`, `profile_updated`, `client_profile_updated`, `inquiry_updated`, `admin_role_assign`, `admin_role_delete`, `admin_org_update`, and `report_feedback_email_viewed`.
- **Defensive Frontend Engineering**:
  - Resolved `logPages` container missing-element reference and added null-safe DOM rendering guards across all admin telemetry modules.

### **Step 49** — Authentication & Registration Hardening
- **Flexible Trainee Lookup**:
  - Implemented case-insensitive and whitespace-trimmed email normalization for trainee profile lookups, preventing login failures due to trailing spaces or uppercase mobile keyboard inputs.
- **Multi-Device / Concurrent OTPs**:
  - Upgraded `temp_otp` validation to support concurrent active OTP sessions across multiple browser tabs and devices, eliminating "invalid code" race conditions when trainees request verification from phone and desktop simultaneously.
- **Capacity Race Condition Safeguards**:
  - Added cache bypass on enrollment validation pathways to guarantee real-time seat lock verification.

### **Step 48** — Trainee Pending Organizations & Admin Review
- **Trainee Self-Declaration**:
  - Trainees from unlisted companies can declare their organization name directly in registration and profile forms (`POST /api/trainee/organizations/register-pending`).
  - Added distinctive "Pending PD" badge in organization search dropdowns to differentiate approved enterprise clients from newly declared entities.
- **Admin Review & Approval Workflow**:
  - Built interactive Pending Organizations management panel in `/admin/index.html` (`GET`, `POST`, `PATCH /api/admin/pending-orgs`).
  - Allows OCE administrators to edit company English names, manage organization status (`approved`, `rejected`, `merged`), and sync declared organizations with master directory records.

### **Step 47** — Final 5 Tables PostgreSQL Migration
- **Full Database Cutover**:
  - Completed schema definition and data migration for the final 5 Google Sheets tables into PostgreSQL `public` schema:
    - `pdc_course master list`
    - `pdc_client_contract_info`
    - `pdc_proposal dateproposal`
    - `pdc_logistic_log`
    - System setting tables (`setting_school_office`, `setting_school_program`)
- **Automated Data Migration Endpoint**:
  - Deployed `POST /api/admin/migrate-final-tables` with dual-security authorization (Admin session or `x-migration-token`).
  - Automated batch transfer and column normalization from Google Sheets into PostgreSQL with error isolation.

### **Step 46** — Admin & Report Portal Audit Polish
- **Security & RBAC**: Masked OTP displays in logs (`••••••`), conditionally concealed emergency `DEBUG_TOKEN` behind `?debug=1` parameter with audit logging on usage.
- **Data Integrity**: Enforced dual PIN confirmation (`confirmNewPin` / `confirmChangePin`) on both Admin and Report portals to eliminate accidental lockout.
- **Reporting & Analytics**:
  - Added one-click **CSV Export** for Registered Trainees, Attendance Matrix, and Feedback Forms.
  - Implemented client-side sorting (Name A-Z, Date Newest, Date Oldest, Status).
  - Clarified "Open" vs "Closed" filters and expanded course search to match Section ID and Date strings.
  - Graceful fallback for non-standard section date ranges and division-by-zero protection.
- **UI/UX Consistency & Accessibility**:
  - Unified session persistence to `localStorage` across both Admin and Report dashboards.
  - Replaced native browser `alert()` and `confirm()` dialogs with inline status badges and two-step action confirmation.
  - Replaced ambiguous color-only check-in indicators with high-contrast accessible icons (`fa-check-circle`, `fa-times-circle`, `fa-minus`).
  - Formatted administrative timestamps strictly in Vietnam ICT timezone (`Asia/Ho_Chi_Minh`) with stale data indicators (>15 mins).
  - Converted raw JSON component status cards into human-readable service status checklists.

### **Step 45** — Developer Documentation Hub
- Upgraded Developer Documentation Hub with Mermaid architecture diagrams, Prism syntax highlighting, and 100% Markdown-driven content.

### **Step 44** — Email OTP Logs & Architecture Tab
- Added Email OTP Logs (PostgreSQL) and Architecture tab to Admin dashboard.

### **Step 43** — PostgreSQL Migration
- Completed database schema migration and API routing for 14 core transaction and master tables including section management, attendee registration, check-ins, and feedback forms, with hybrid routing configuration to maintain Google Sheets fallback.

### **Step 42** — Advanced Caching Refinements
- Implemented cache-bypass capabilities on all write validation pathways (registration, check-in, feedback, OTP verification, profiles, and PIN updates) to prevent double-submission race conditions.
- Added write-through caching to update reads immediately.
- Extended static data caching TTL to 30 seconds for master lists (courses and venues).

### **Step 41** — Operational Stability & Hotfixes
- Case-insensitive section type mapping.
- 3-second edge caching for Google Sheets API reads.
- Trainee PIN text format preservation to prevent leading-zero truncation.
- 6-digit input length validation on check-in code.
- Frontend failure recovery handling to prevent login page freeze.

### **Step 40** — UI/UX Refinement
- Refined gradients, cards, and input glows. Soft Alert badges.

### **Step 39** — Admin Monitoring Logs
- User access, OTP email send/verify counts, and recent operational log entries.

### **Step 38** — Admin OTP Login & Polish
- Admin OTP login, admin docs/change log, home admin link, login back-to-home buttons, mobile UI polish.

### **Step 37** — Admin Status Page
- Admin status page and monitoring visibility.

### **Step 36** — Final Go-Live Closeout Package
- System hardening and deployment freeze verification.

### **Step 32 Fix 2** — Friendly Client Profile UX
- Friendly client profile-not-found UX.

### **Step 30** — Real OTP Email with Brevo
- Integrated transactional email routing with Brevo fallback.

### **Step 27** — Hybrid Stable
- Google Sheets core + PostgreSQL Organization via Hyperdrive.

### **Step 24–25** — Trainee Frontend Cutover
- Cutover from GAS to Cloudflare API and stable package.

### **Step 14** — Client Stable Cutover
- Cutover from GAS to Cloudflare API.
