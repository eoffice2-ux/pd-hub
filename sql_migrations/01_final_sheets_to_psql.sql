-- 01_final_sheets_to_psql.sql
-- Run this script in PostgreSQL (schema: public)
-- Target tables: temp_otp, pdc_app_logs, pdc_user_roles, pdc_client_contract_info, pdc_course master list

-- 1. temp_otp (Transient OTP caching)
CREATE TABLE IF NOT EXISTS public.temp_otp (
    "email" VARCHAR(255) NOT NULL,
    "otp_hash" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    "used_at" TIMESTAMP WITH TIME ZONE,
    "send_provider" VARCHAR(50),
    "request_ip" VARCHAR(100),
    "user_agent" TEXT,
    PRIMARY KEY ("email", "scope")
);

-- 2. pdc_app_logs (System operational audit logs)
CREATE TABLE IF NOT EXISTS public.pdc_app_logs (
    "id" SERIAL PRIMARY KEY,
    "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "event" VARCHAR(255),
    "scope" VARCHAR(100),
    "email" VARCHAR(255),
    "path" TEXT,
    "success" VARCHAR(10),
    "provider" VARCHAR(100),
    "message_id" TEXT,
    "detail" TEXT,
    "ip" VARCHAR(100),
    "user_agent" TEXT
);

-- 3. pdc_user_roles (Admin & viewer role assignments and PINs)
CREATE TABLE IF NOT EXISTS public.pdc_user_roles (
    "email" VARCHAR(255) PRIMARY KEY,
    "role" VARCHAR(50),
    "assigned_by" VARCHAR(255),
    "assigned_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "pin number" VARCHAR(20)
);

-- 4. pdc_client_contract_info (Corporate client representative and company profiles)
CREATE TABLE IF NOT EXISTS public.pdc_client_contract_info (
    "client id" VARCHAR(100) PRIMARY KEY,
    "client name vn" VARCHAR(255),
    "client name en" VARCHAR(255),
    "client address vn" TEXT,
    "client address en" TEXT,
    "client phone number" VARCHAR(50),
    "tax code" VARCHAR(50),
    "representative name vn" VARCHAR(255),
    "representative name en" VARCHAR(255),
    "representative position en" VARCHAR(255),
    "representative position vn" VARCHAR(255),
    "client updater id" VARCHAR(255),
    "client updater email" VARCHAR(255),
    "client updated at" VARCHAR(100),
    "updated by" VARCHAR(255),
    "updated at" VARCHAR(100)
);

-- 5. pdc_course master list (Canonical course catalog)
CREATE TABLE IF NOT EXISTS public."pdc_course master list" (
    "course id" VARCHAR(100) PRIMARY KEY,
    "course code" VARCHAR(100),
    "course name" VARCHAR(255),
    "course name en" VARCHAR(255),
    "course name vn" VARCHAR(255),
    "course level" VARCHAR(255),
    "course objectives" TEXT,
    "course description" TEXT,
    "content introduction en" TEXT,
    "content introduction vn" TEXT,
    "program outline en file" TEXT,
    "program outline vn file" TEXT,
    "program outline en" TEXT,
    "program outline vn" TEXT,
    "objectives en" TEXT,
    "objectives vn" TEXT,
    "duration" VARCHAR(255),
    "course language" VARCHAR(255),
    "certificate template id" VARCHAR(255),
    "venue suitable" VARCHAR(255),
    "course training fee" VARCHAR(255),
    "course assignment" TEXT,
    "course prerequisite" TEXT,
    "course type" VARCHAR(255),
    "teaching methodologies" TEXT,
    "school lead" VARCHAR(255),
    "pd track" VARCHAR(255),
    "pre - assignment" TEXT,
    "post - assignment" TEXT,
    "target audience" TEXT,
    "course status" VARCHAR(255),
    "pd lead approve status" VARCHAR(255),
    "approver approve status" VARCHAR(255),
    "sme main" VARCHAR(255),
    "sme coordinator" VARCHAR(255),
    "sme lead" VARCHAR(255),
    "updated by" VARCHAR(255),
    "updated at" VARCHAR(255)
);

-- 02. pdc_pending_organizations (User-submitted orgs awaiting admin review)
CREATE TABLE IF NOT EXISTS public.pdc_pending_organizations (
  "pd_id"        VARCHAR(255) PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "submitted_by" VARCHAR(255),
  "created_at"   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "status"       VARCHAR(50) DEFAULT 'pending'  -- pending | verified | promoted | rejected
);
