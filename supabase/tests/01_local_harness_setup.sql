-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- TEST HARNESS SETUP: 01_local_harness_setup.sql
-- ============================================================================
-- Purpose: Prepares a clean, standard local PostgreSQL 15+ instance to emulate
-- the required Supabase environment (schemas, auth tables, auth.uid(), and roles).
--
-- IMPORTANT: This harness is strictly for local disposable testing. It is NEVER
-- executed against production or a live Supabase project.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Create Required Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- 2. Create Required Database Roles (Simulating Supabase Client Roles)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
    END IF;
END $$;

-- 3. Grant schema usage & permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- 4. Mock auth.users table
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT clock_timestamp()
);

GRANT SELECT ON auth.users TO authenticated, service_role;

-- 5. Mock auth.uid() Session Function
-- Evaluates the session variable "request.jwt.claim.sub" to simulate actor identity
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated;

COMMIT;
