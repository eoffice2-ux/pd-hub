# Version Changes / Change Log

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
