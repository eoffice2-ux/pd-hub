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
    "client updater email" VARCHAR(255),
    "client name vn" VARCHAR(255),
    "client name en" VARCHAR(255),
    "client address vn" TEXT,
    "client address en" TEXT,
    "tax code" VARCHAR(50),
    "client phone number" VARCHAR(50),
    "representative name vn" VARCHAR(255),
    "representative name en" VARCHAR(255),
    "representative position vn" VARCHAR(255),
    "representative position en" VARCHAR(255),
    "updated at" VARCHAR(100),
    "updated by" VARCHAR(255)
);

-- 5. pdc_course master list (Canonical course catalog)
CREATE TABLE IF NOT EXISTS public."pdc_course master list" (
    "course id" VARCHAR(100) PRIMARY KEY,
    "course name" VARCHAR(255),
    "course name en" VARCHAR(255),
    "course name vn" VARCHAR(255),
    "course objectives" TEXT,
    "course description" TEXT
);
