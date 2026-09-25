# MAP: Database Table → Web Page → API Function

Cross-reference of every DB table/sheet, the web page(s) that render it, and the API route + function that services it.
Rule: Keep in sync whenever a new table, page, or route is added.

---

## Legend
- **Table Key** = env-resolved key used in `TAB_<KEY>_SOURCE` / `isPsql(env, KEY)`
- **Source** = `psql` | `gsheet` (runtime-switchable per key)
- **Page** = HTML file under `public/`
- **Route** = Cloudflare Pages Function path under `functions/api/`
- **Method** = HTTP verb exposed to browser

---

## 1. TRAINEE_PROFILE
- **Table**: `public.pdc_trainee general profile`
- **Source**: psql (TAB_TRAINEE_PROFILE_SOURCE)
- **Sheet fallback**: `pdc_trainee general profile` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `trainee id`, `trainee full name`, `trainee pin`, `trainee phone`, `trainee gender`, `trainee email`, `trainee position`, `trainee organization id`, `trainee organization new`, `trainee type`, `school`, `department` | `trainee full name`, `trainee phone`, `trainee gender`, `trainee position`, `trainee organization id`, `trainee organization new`, `user updated datetime`, `updated by`, `updated at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | viewProfile | `GET /api/trainee/profile` | `functions/api/trainee/profile.js` | GET | `onRequestGet` → `getTraineeProfilePsql` / `readTraineeTable` |
| `public/trainee/index.html` | viewProfile | `POST /api/trainee/profile/update` | `functions/api/trainee/profile/update.js` | POST | `onRequestPost` → `updateTraineeProfileFromUiPsql` / `updateTraineeProfileInSheet` |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads traineeSheet for name lookups) |

---

## 2. SECTION
- **Table**: `public.pdc_section management`
- **Source**: psql (TAB_SECTION_SOURCE)
- **Sheet fallback**: `pdc_section management` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `section id`, `section number`, `section name en`, `section name vn`, `section date`, `section trainee type`, `section type`, `section venue`, `section room id`, `section status`, `date start registration`, `date end registration`, `course id`, `inquiry id`, `client id`, `bd incharge id` | (admin only; no UI write route) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | viewCatalog | `GET /api/trainee/sections` | `functions/api/trainee/sections.js` | GET | `onRequestGet` → `getTraineeSectionsPsql` / `getTraineeSectionsFromSheet` |
| `public/trainee/index.html` | viewActive | `GET /api/trainee/active-sections` | `functions/api/trainee/active-sections.js` | GET | `onRequestGet` → `getTraineeActiveSectionsPsql` / `getTraineeActiveSectionsFromSheet` |
| `public/trainee/index.html` | ClassDetailModal | `GET /api/trainee/section/details` | `functions/api/trainee/section/details.js` | GET | `onRequestGet` → `getSectionDetailsPsql` / `getTraineeSectionDetailsFromSheet` |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads secSheet as primary data source) |
| `(AppSheet Webhook)` | — | `POST /api/webhooks/appsheet/update-schedule` | `functions/api/webhooks/appsheet/update-schedule.js` | POST | `onRequestPost` → mass or individual schedule update |

---

## 3. SECTION_ATTENDEE
- **Table**: `public.pdc_section attendee management`
- **Source**: psql (TAB_SECTION_ATTENDEE_SOURCE)
- **Sheet fallback**: `pdc_section attendee management` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `section attendee id`, `section id`, `section name`, `course id`, `trainee id`, `registered at`, `checkin completion`, `assessment completion`, `feedback completion`, `certificate file issued` | `section attendee id`, `section id`, `section name`, `course id`, `trainee id`, `registered at`, `updated at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | viewReg | `POST /api/trainee/register` | `functions/api/trainee/register.js` | POST | `onRequestPost` → `registerTraineeForSectionPsql` / `registerTraineeForSectionInSheet` |
| `public/trainee/index.html` | viewHistory | `GET /api/trainee/history` | `functions/api/trainee/history.js` | GET | `onRequestGet` → `getTraineeHistoryPsql` / `getTraineeHistoryFromSheet` |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads regSheet for attendance counts) |
| `(AppSheet Webhook)` | — | `POST /api/webhooks/appsheet/cancel-registration` | `functions/api/webhooks/appsheet/cancel-registration.js` | POST | `onRequestPost` → sends `.ics` cancellation to trainee |
| `(AppSheet Webhook)` | — | `POST /api/webhooks/appsheet/new-registration` | `functions/api/webhooks/appsheet/new-registration.js` | POST | `onRequestPost` → sends registration confirmation email to trainee |

---

## 4. CHECKIN_PLAN
- **Table**: `public.pdc_section checkin management`
- **Source**: psql (TAB_CHECKIN_PLAN_SOURCE)
- **Sheet fallback**: `pdc_section checkin management` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `checkin slot id`, `section id`, `dateid`, `checkin date`, `checkin type`, `checkin valid from`, `checkin valid to`, `checkin code` | (admin only; no UI write route) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | CheckinModal | `GET /api/trainee/checkin/data` | `functions/api/trainee/checkin/data.js` | GET | `onRequestGet` → `getTraineeCheckinDataPsql` / `getTraineeCheckinDataFromSheet` |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads checkinPlanSheet for slot metadata) |

---

## 5. CHECKIN_LOG
- **Table**: `public.pdc_section checkin log`
- **Source**: psql (TAB_CHECKIN_LOG_SOURCE)
- **Sheet fallback**: `pdc_section checkin log` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `section attendee id`, `checkin slot id`, `section id`, `trainee id`, `checkin time stamp` | `section attendee id`, `checkin slot id`, `section id`, `trainee id`, `checkin time stamp` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | CheckinModal | `POST /api/trainee/checkin/submit` | `functions/api/trainee/checkin/submit.js` | POST | `onRequestPost` → `submitTraineeCheckinPsql` / `submitTraineeCheckinToSheet` |
| `public/trainee/index.html` | CheckinModal | `GET /api/trainee/checkin/data` | `functions/api/trainee/checkin/data.js` | GET | `onRequestGet` (logs[] returned alongside plans) |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads checkinSheet for completion stats) |

---

## 6. FB_SECTIONFORMS
- **Table**: `public.pdc_fb_sectionforms`
- **Source**: psql (TAB_FB_SECTIONFORMS_SOURCE)
- **Sheet fallback**: `pdc_fb_sectionforms` tab in GOOGLE_SHEET_ID_FEEDBACK

### Columns
| Read | Written |
|---|---|
| `id`, `form_id`, `form_title`, `section id`, `response starttime`, `response endtime` | (admin only) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | FormsModal | `GET /api/trainee/forms` | `functions/api/trainee/forms/index.js` | GET | `onRequestGet` → `getFormsForSectionPsql` / `getFormsForSectionFromSheet` |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads fbSecFormsSheet) |

---

## 7. FB_FORMS
- **Table**: `public.pdc_fb_forms`
- **Source**: psql (TAB_FB_FORMS_SOURCE)

### Columns
| Read | Written |
|---|---|
| `form_id`, `title`, `description`, `created_at`, `is_active` | (admin only) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | FormsModal | `GET /api/trainee/forms/questions` | `functions/api/trainee/forms/questions/` | GET | joins FB_FORMS for title/description |

---

## 8. FB_QUESTIONS
- **Table**: `public.pdc_fb_questions`
- **Source**: psql (TAB_FB_QUESTIONS_SOURCE)

### Columns
| Read | Written |
|---|---|
| `question_id`, `form_id`, `question_text`, `question_type`, `options`, `is_required`, `sort_order` | (admin only) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | FormSubmissionModal | `GET /api/trainee/forms/questions` | `functions/api/trainee/forms/questions/` | GET | questions loader repo |

---

## 9. FB_SUBMISSIONS
- **Table**: `public.pdc_fb_submissions`
- **Source**: psql (TAB_FB_SUBMISSIONS_SOURCE)
- **Sheet fallback**: `pdc_fb_submissions` tab in GOOGLE_SHEET_ID_FEEDBACK

### Columns
| Read | Written |
|---|---|
| `submission_id`, `form_id`, `mapping_id`, `trainee_id`, `submitted_at` | `submission_id`, `form_id`, `mapping_id`, `trainee_id`, `submitted_at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | FormSubmissionModal | `POST /api/trainee/forms/submit` | `functions/api/trainee/forms/submit/` | POST | feedback submit repo |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads fbSubmissionsSheet for completion %) |

---

## 10. FB_RESPONSES
- **Table**: `public.pdc_fb_responses`
- **Source**: psql (TAB_FB_RESPONSES_SOURCE)

### Columns
| Read | Written |
|---|---|
| `response_id`, `submission_id`, `question_id`, `answer_value` | `response_id`, `submission_id`, `question_id`, `answer_value` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | FormSubmissionModal | `POST /api/trainee/forms/submit` | `functions/api/trainee/forms/submit/` | POST | writes one row per answer |

---

## 11. CLIENT_INQUIRY
- **Table**: `public.pdc_inquiry management`
- **Source**: psql (TAB_CLIENT_INQUIRY_SOURCE)
- **Sheet fallback**: `pdc-inquiry management` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `inquiry id`, `client id`, `client representative email`, `internal requester`, `topic interest`, `main objectives of training`, `targeted trainee profile`, `targeted trainee qty`, `language perfer`, `online_offline`, `venue`, `desired training timeline`, `estimated duration`, `estimated budget`, `bd incharge`, `inquiry status`, `client representative name`, `client representative postition`, `client representative phone number` | `inquiry status`, `updated by`, `updated at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/client/index.html` | viewInquiryList | `GET /api/client/inquiries` | `functions/api/client/inquiries.js` | GET | `onRequestGet` → `getClientInquiriesPsql` / sheet scan by `client representative email` |
| `public/client/index.html` | viewInquiryDetail | `POST /api/client/inquiry/update` | `functions/api/client/inquiry/` | POST | inquiry update repo |

---

## 12. CLIENT_PROFILE
- **Source**: gsheet only (GOOGLE_SHEET_ID_CORE)
- **Sheet**: `pdc_client_contract_info`

### Columns
| Read | Written |
|---|---|
| `client id`, `client updater email`, `client name vn`, `client name en`, `client address vn`, `client address en`, `tax code`, `client phone number`, `representative name vn`, `representative name en`, `representative position vn`, `representative position en` | `updated at`, `updated by` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/client/index.html` | viewCorporate | `GET /api/client/profile` | `functions/api/client/profile.js` | GET | `onRequestGet` (sheet scan by `client updater email`) |
| `public/client/index.html` | viewPersonal | `GET /api/client/profile` | `functions/api/client/profile.js` | GET | same — personal view renders subset |
| `public/client/index.html` | viewPersonal | `POST /api/client/profile/update` | `functions/api/client/profile/update.js` | POST | client profile update repo |

---

## 13. ORGANIZATION (oce_industry_list)
- **Table**: `public.oce_industry_list`
- **Source**: psql only (TAB_ORGANIZATION_SOURCE=psql)

### Columns
| Read | Written |
|---|---|
| `id` (organization id), `name` (organization name) | none |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | viewProfile (org autocomplete) | `GET /api/trainee/organizations/search` | `functions/api/trainee/organizations/search.js` | GET | `onRequestGet` → `searchOrganizationsPsql` (q param, limit 15) |

---

## 14. VENUE
- **Table**: `public.pdc_room lab management`
- **Source**: psql (TAB_VENUE_SOURCE)
- **Sheet fallback**: `pdc-room lab management` tab in GOOGLE_SHEET_ID_CORE

### Columns
| Read | Written |
|---|---|
| `facility id`, `room title`, `room title vi`, `room type`, `building block`, `room no`, `capacity`, `room access type` | none |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | ClassDetailModal | `GET /api/trainee/section/details` | `functions/api/trainee/section/details.js` | GET | `getSectionDetailsPsql` (joins VENUE for `room title`) |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads venueSheet for room name display) |

---

## 15. COURSE_MASTER
- **Source**: gsheet only (GOOGLE_SHEET_ID_CORE)
- **Sheet**: `pdc_course master list`

### Columns
| Read | Written |
|---|---|
| `course id`, `course name en`, `course name`, description fields | none |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/trainee/index.html` | ClassDetailModal | `GET /api/trainee/section/details` | `functions/api/trainee/section/details.js` | GET | `getSectionDetailsPsql` / `getTraineeSectionDetailsFromSheet` (resolves course name) |
| `public/report.html` | reportApp | `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | `onRequestGet` (reads courseSheet for course name lookup) |

---

## 16. USER_ROLES
- **Source**: gsheet only (GOOGLE_SHEET_ID_CORE)
- **Sheet**: `pdc_user_roles`

### Columns
| Read | Written |
|---|---|
| `email`, `role` | `email`, `role`, `updated_by`, `updated_at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/admin/index.html` | panelRoles | `GET /api/admin/roles` | `functions/api/admin/roles.js` | GET | `onRequestGet` → `listUserRoles` |
| `public/admin/index.html` | panelRoles | `POST /api/admin/roles` | `functions/api/admin/roles.js` | POST | `onRequestPost` → `setUserRole` |
| `public/admin/index.html` | panelRoles | `DELETE /api/admin/roles` | `functions/api/admin/roles.js` | DELETE | `onRequestDelete` → `deleteUserRole` |

---

## 17. temp_otp (transient OTP)
- **Source**: gsheet only (GOOGLE_SHEET_ID_CORE)
- **Sheet**: tab name from `TAB_OTP_GSHEET` env var

### Columns
| Read | Written |
|---|---|
| `email`, `otp`, `scope`, `expires_at` | `email`, `otp`, `scope`, `expires_at` |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/index.html` | viewLogin (admin) | `POST /api/auth/send-otp` | `functions/api/auth/send-otp.js` | POST | `onRequestPost` → `storeOtp` + `sendOtpEmail` |
| `public/index.html` | viewLogin (admin) | `POST /api/auth/verify-otp` | `functions/api/auth/verify-otp.js` | POST | `onRequestPost` → OTP verify + session issue |
| `public/client/index.html` | viewLogin | `POST /api/auth/send-otp` | same | POST | same (scope=client) |
| `public/client/index.html` | viewLogin | `POST /api/auth/verify-otp` | same | POST | same |

---

## 18. pdc_app_logs (application event log)
- **Source**: gsheet only (GOOGLE_SHEET_ID_CORE)
- **Sheet**: tab name from `TAB_APP_LOG_GSHEET` env var

### Columns
| Read | Written |
|---|---|
| `timestamp`, `event`, `scope`, `email`, `success`, `detail`, `provider`, `ip` | same (append-only) |

### Routes
| Page | View/Panel | Route | File | Method | Function |
|---|---|---|---|---|---|
| `public/admin/index.html` | panelLogs | `GET /api/admin/status` | `functions/api/admin/status.js` | GET | `onRequestGet` → `readAppLogs` + `summarizeAppLogs` |
| *(written by)* | — | `POST /api/auth/send-otp` | `functions/api/auth/send-otp.js` | POST | `appendAppLog` on every OTP send |
| *(written by)* | — | `POST /api/auth/verify-otp` | `functions/api/auth/verify-otp.js` | POST | `appendAppLog` on every OTP verify |
| *(written by)* | — | `POST /api/auth/verify-pin` | `functions/api/auth/verify-pin.js` | POST | `appendAppLog` on PIN verify |

---

## 19. PROPOSAL_DATEPROPOSAL
- **Table**: `public.pdc_proposal dateproposal`
- **Source**: psql (TAB_PROPOSAL_DATEPROPOSAL_SOURCE)
- **Note**: No direct UI page currently; scheduling metadata

### Columns
`dateid`, `proposal id`, `section id`, `proposal date`, `section`, `hours`, `room id`, `notes`, `updated by`, `updated at`

---

## 20. LOGISTIC_LOG
- **Table**: `public.pdc_logistic_log`
- **Source**: psql (TAB_LOGISTIC_LOG_SOURCE)
- **Note**: No direct UI page currently; operational backend table

### Columns
`log_id`, `proposal id`, `section id`, `logistic id`, `preparation type`, `check list items`, `contact office`, `contact person`, `pd pic`, `checking status`, `note`, `updated by`, `updated at`

---

## 21. SCHOOL_OFFICE
- **Table**: `public.setting_school_office`
- **Source**: psql
- **Columns Read**: `id`, `name`, `school_office_type` | **Written**: none (admin-managed)
- **Routes**:
  | Page | View/Panel | Route | File | Method | Function |
  |---|---|---|---|---|---|
  | `public/trainee/index.html` | viewProfile (EIU School dropdown) | `GET /api/trainee/schools` | `functions/api/trainee/schools.js` | GET | `onRequestGet` → `getSchoolsPsql` |

---

## 22. SCHOOL_PROGRAM
- **Table**: `public.setting_school_program`
- **Source**: psql
- **Columns Read**: `id`, `program_function`, `school_office_id` | **Written**: none (admin-managed)
- **Routes**:
  | Page | View/Panel | Route | File | Method | Function |
  |---|---|---|---|---|---|
  | `public/trainee/index.html` | viewProfile (EIU Major dropdown) | `GET /api/trainee/programs` | `functions/api/trainee/programs.js` | GET | `onRequestGet` → `getProgramsPsql` |

---

## Auth Routes Summary (no direct DB table)

| Route | File | Method | Action |
|---|---|---|---|
| `POST /api/auth/send-otp` | `functions/api/auth/send-otp.js` | POST | Generate + email OTP; store in temp_otp |
| `POST /api/auth/verify-otp` | `functions/api/auth/verify-otp.js` | POST | Verify OTP; issue signed session cookie |
| `POST /api/auth/verify-pin` | `functions/api/auth/verify-pin.js` | POST | Verify trainee PIN; issue signed session cookie |
| `POST /api/auth/set-pin` | `functions/api/auth/set-pin.js` | POST | Write `trainee pin` to TRAINEE_PROFILE |
| `GET /api/auth/access-type` | `functions/api/auth/access-type.js` | GET | Detect trainee type (eiu/industry/unknown) |
| `GET /api/trainee/access-type` | `functions/api/trainee/access-type.js` | GET | Return trainee type from session |

---

## Admin / Report Routes Summary

| Route | File | Method | Tables Accessed |
|---|---|---|---|
| `GET /api/admin/status` | `functions/api/admin/status.js` | GET | pdc_app_logs (read), all table sources (describe) |
| `GET /api/admin/roles` | `functions/api/admin/roles.js` | GET | USER_ROLES |
| `POST /api/admin/roles` | `functions/api/admin/roles.js` | POST | USER_ROLES |
| `DELETE /api/admin/roles` | `functions/api/admin/roles.js` | DELETE | USER_ROLES |
| `GET /api/report/report-data` | `functions/api/report/report-data.js` | GET | SECTION, SECTION_ATTENDEE, CHECKIN_LOG, CHECKIN_PLAN, COURSE_MASTER, VENUE, TRAINEE_PROFILE, FB_SECTIONFORMS, FB_SUBMISSIONS |
| `GET /api/health` | `functions/api/health.js` | GET | none (liveness check only) |

---

## Page → All Tables Matrix

| Page | Tables / Sheets Accessed |
|---|---|
| `public/index.html` (admin login) | temp_otp, pdc_app_logs, USER_ROLES |
| `public/trainee/index.html` | TRAINEE_PROFILE, SECTION, SECTION_ATTENDEE, CHECKIN_PLAN, CHECKIN_LOG, FB_SECTIONFORMS, FB_FORMS, FB_QUESTIONS, FB_SUBMISSIONS, FB_RESPONSES, ORGANIZATION, SCHOOL_OFFICE, SCHOOL_PROGRAM |
| `public/client/index.html` | CLIENT_PROFILE, CLIENT_INQUIRY, temp_otp, pdc_app_logs |
| `public/admin/index.html` | USER_ROLES, pdc_app_logs, all table sources (describe via status) |
| `public/report.html` | SECTION, SECTION_ATTENDEE, CHECKIN_LOG, CHECKIN_PLAN, COURSE_MASTER, VENUE, TRAINEE_PROFILE, FB_SECTIONFORMS, FB_SUBMISSIONS |
