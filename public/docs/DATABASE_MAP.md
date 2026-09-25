# Database & API Route Matrix

Complete cross-reference of every database table/sheet, the web page(s) that consume it, the Cloudflare Functions route, and HTTP verbs.

> [!TIP]
> **Source Legend:**
> - `psql`: Primary PostgreSQL table routed via Cloudflare Hyperdrive.
> - `gsheet`: Google Sheets worksheet accessed via Service Account API v4.
> - `psql / gsheet`: Hybrid route dynamically controlled by `env.DB_MODE` and `TAB_<KEY>_SOURCE`.

---

## Master Table Inventory

| # | Table Key | Primary Table / Sheet Name | Default Source | Primary Consumer Page |
|---|---|---|---|---|
| 1 | `TRAINEE_PROFILE` | `public.pdc_trainee general profile` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 2 | `SECTION` | `public.pdc_section management` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 3 | `SECTION_ATTENDEE` | `public.pdc_section attendee management` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 4 | `CHECKIN_PLAN` | `public.pdc_section checkin management` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 5 | `CHECKIN_LOG` | `public.pdc_section checkin log` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 6 | `FB_SECTIONFORMS` | `public.pdc_fb_sectionforms` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 7 | `FB_FORMS` | `public.pdc_fb_forms` | `psql` | `/trainee/index.html` |
| 8 | `FB_QUESTIONS` | `public.pdc_fb_questions` | `psql` | `/trainee/index.html` |
| 9 | `FB_SUBMISSIONS` | `public.pdc_fb_submissions` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 10 | `FB_RESPONSES` | `public.pdc_fb_responses` | `psql` | `/trainee/index.html` |
| 11 | `CLIENT_INQUIRY` | `public.pdc_inquiry management` | `psql` / `gsheet` | `/client/index.html` |
| 12 | `CLIENT_PROFILE` | `pdc_client_contract_info` | `gsheet` | `/client/index.html` |
| 13 | `ORGANIZATION` | `public.oce_industry_list` | `psql` | `/trainee/index.html` |
| 14 | `VENUE` | `public.pdc_room lab management` | `psql` / `gsheet` | `/trainee/index.html`, `/report.html` |
| 15 | `COURSE_MASTER` | `pdc_course master list` | `gsheet` | `/trainee/index.html`, `/report.html` |
| 16 | `USER_ROLES` | `pdc_user_roles` | `gsheet` | `/admin/index.html` |
| 17 | `temp_otp` | Transient OTP Sheet Tab | `gsheet` | `/index.html`, `/client/index.html`, `/admin/index.html` |
| 18 | `pdc_app_logs` | Operational Event Log | `gsheet` | `/admin/index.html` |
| 19 | `PROPOSAL_DATEPROPOSAL`| `public.pdc_proposal dateproposal` | `psql` | Backend / Scheduling |
| 20 | `LOGISTIC_LOG` | `public.pdc_logistic_log` | `psql` | Backend / Operational |
| 21 | `SCHOOL_OFFICE` | `public.setting_school_office` | `psql` | `/trainee/index.html` |
| 22 | `SCHOOL_PROGRAM` | `public.setting_school_program` | `psql` | `/trainee/index.html` |

---

## Detailed Table Specifications

### 1. TRAINEE_PROFILE
- **Table:** `public.pdc_trainee general profile`
- **Fallback Tab:** `pdc_trainee general profile` in `GOOGLE_SHEET_ID_CORE`
- **Columns Read:** `trainee id`, `trainee full name`, `trainee pin`, `trainee phone`, `trainee gender`, `trainee email`, `trainee position`, `trainee organization id`, `trainee organization new`, `trainee type`, `school`, `department`
- **Columns Written:** `trainee full name`, `trainee phone`, `trainee gender`, `trainee position`, `trainee organization id`, `trainee organization new`, `user updated datetime`, `updated by`, `updated at`
- **Routes & Handlers:**
  - `GET /api/trainee/profile` (`functions/api/trainee/profile.js`) &rarr; `getTraineeProfilePsql` / `readTraineeTable`
  - `POST /api/trainee/profile/update` (`functions/api/trainee/profile/update.js`) &rarr; `updateTraineeProfileFromUiPsql` / `updateTraineeProfileInSheet`
  - `GET /api/report/report-data` (`functions/api/report/report-data.js`) &rarr; Trainee profile lookup

---

### 2. SECTION
- **Table:** `public.pdc_section management`
- **Fallback Tab:** `pdc_section management` in `GOOGLE_SHEET_ID_CORE`
- **Columns Read:** `section id`, `section number`, `section name en`, `section name vn`, `section date`, `section trainee type`, `section type`, `section venue`, `section room id`, `section status`, `date start registration`, `date end registration`, `course id`, `inquiry id`, `client id`, `bd incharge id`
- **Columns Written:** Admin / AppSheet updates only
- **Routes & Handlers:**
  - `GET /api/trainee/sections` (`functions/api/trainee/sections.js`) &rarr; Course catalog listing
  - `GET /api/trainee/active-sections` (`functions/api/trainee/active-sections.js`) &rarr; Trainee enrolled sections
  - `GET /api/trainee/section/details` (`functions/api/trainee/section/details.js`) &rarr; Section modal detail
  - `GET /api/report/report-data` (`functions/api/report/report-data.js`) &rarr; Section analytics
  - `POST /api/webhooks/appsheet/update-schedule` (`functions/api/webhooks/appsheet/update-schedule.js`) &rarr; Schedule revision

---

### 3. SECTION_ATTENDEE
- **Table:** `public.pdc_section attendee management`
- **Fallback Tab:** `pdc_section attendee management` in `GOOGLE_SHEET_ID_CORE`
- **Columns Read:** `section attendee id`, `section id`, `section name`, `course id`, `trainee id`, `registered at`, `checkin completion`, `assessment completion`, `feedback completion`, `certificate file issued`
- **Columns Written:** `section attendee id`, `section id`, `section name`, `course id`, `trainee id`, `registered at`, `updated at`
- **Routes & Handlers:**
  - `POST /api/trainee/register` (`functions/api/trainee/register.js`) &rarr; Atomic section enrollment
  - `GET /api/trainee/history` (`functions/api/trainee/history.js`) &rarr; Trainee learning history
  - `GET /api/report/report-data` (`functions/api/report/report-data.js`) &rarr; Attendance metrics
  - `POST /api/webhooks/appsheet/cancel-registration` &rarr; Send `.ics` calendar cancellation

---

### 4. CHECKIN_PLAN & CHECKIN_LOG
- **Plan Table:** `public.pdc_section checkin management` (`checkin slot id`, `section id`, `checkin date`, `checkin type`, `checkin valid from`, `checkin valid to`, `checkin code`)
- **Log Table:** `public.pdc_section checkin log` (`section attendee id`, `checkin slot id`, `section id`, `trainee id`, `checkin time stamp`)
- **Routes & Handlers:**
  - `GET /api/trainee/checkin/data` (`functions/api/trainee/checkin/data.js`) &rarr; Load available slots & existing logs
  - `POST /api/trainee/checkin/submit` (`functions/api/trainee/checkin/submit.js`) &rarr; Validate 6-digit code, time window, and commit log

---

### 5. FEEDBACK ENGINE (`FB_*`)
- **Section Forms:** `public.pdc_fb_sectionforms` (maps section &rarr; feedback form)
- **Forms:** `public.pdc_fb_forms` (form metadata, title, instructions)
- **Questions:** `public.pdc_fb_questions` (question texts, types, choices)
- **Submissions:** `public.pdc_fb_submissions` (overall submission record per trainee)
- **Responses:** `public.pdc_fb_responses` (individual question responses)
- **Routes & Handlers:**
  - `GET /api/trainee/forms` &rarr; Available forms for active section
  - `GET /api/trainee/forms/questions` &rarr; Question list with ordering
  - `POST /api/trainee/forms/submit` &rarr; Commit submission and answers

---

### 6. CLIENT INQUIRIES & PROFILE
- **Inquiry Table:** `public.pdc_inquiry management`
  - `GET /api/client/inquiries` &rarr; Inquiries filtered by `client representative email`
  - `POST /api/client/inquiry/update` &rarr; Client status and requirement updates
- **Profile Sheet:** `pdc_client_contract_info` (Google Sheets only)
  - `GET /api/client/profile` &rarr; Corporate and personal profile details
  - `POST /api/client/profile/update` &rarr; Update contact & representative info

---

### 7. MASTER METADATA & SYSTEM LOGS
- **ORGANIZATION (`public.oce_industry_list`):** Autocomplete endpoint `GET /api/trainee/organizations/search?q=...`
- **VENUE (`public.pdc_room lab management`):** Room titles, campus buildings, and capacities.
- **COURSE_MASTER (`pdc_course master list`):** Canonical course names and descriptions.
- **USER_ROLES (`pdc_user_roles`):** RBAC authorization matrix managed in Admin (`GET`, `POST`, `DELETE /api/admin/roles`).
- **pdc_app_logs:** Audit trail capturing every user login, OTP send, and admin operational check.
