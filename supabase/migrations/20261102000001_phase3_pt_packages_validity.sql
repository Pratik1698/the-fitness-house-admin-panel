-- ============================================================================
-- Phase 3: Personal Training Packages Schema Enhancement
-- File: 20261102000001_phase3_pt_packages_validity.sql
-- 
-- Description:
-- Adds validity_days column to public.pt_packages with safe default of 30 days.
-- Ensures existing package records receive the 30-day default and enforces
-- a positive integer constraint (> 0).
-- 
-- Safety & Compatibility:
--  - Does NOT alter or recreate public.pt_assignments.
--  - Existing PT client assignments remain untouched with their historical
--    session counts, fee snapshots, and start dates intact.
--  - Idempotent and non-destructive.
-- ============================================================================

DO $$
BEGIN
    -- 1. Add column if it does not already exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'pt_packages' 
          AND column_name = 'validity_days'
    ) THEN
        ALTER TABLE public.pt_packages
        ADD COLUMN validity_days INTEGER DEFAULT 30;
    END IF;

    -- 2. Populate any NULL values with the default 30 days
    UPDATE public.pt_packages
    SET validity_days = 30
    WHERE validity_days IS NULL;

    -- 3. Enforce NOT NULL and positive check constraint safely
    ALTER TABLE public.pt_packages
    ALTER COLUMN validity_days SET NOT NULL;

    -- Drop constraint if exists then re-add to guarantee naming
    ALTER TABLE public.pt_packages
    DROP CONSTRAINT IF EXISTS chk_pt_packages_validity_days;

    ALTER TABLE public.pt_packages
    ADD CONSTRAINT chk_pt_packages_validity_days CHECK (validity_days > 0);

    COMMENT ON COLUMN public.pt_packages.validity_days IS 'Package validity duration in days from assignment start date';
END $$;

