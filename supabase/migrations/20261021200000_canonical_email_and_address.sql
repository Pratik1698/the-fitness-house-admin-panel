-- ============================================================================
-- Migration: 20261021200000_canonical_email_and_address.sql
-- Description: Updates public.gym_info email, address, and defaults to canonical:
--              email: pravinjoshi2707@gmail.com
--              address: Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra
-- Safety: Fully idempotent and backward-compatible. Preserves all accounts,
--         audit records, and financial ledger data.
-- ============================================================================

-- 1. Update column defaults on public.gym_info
ALTER TABLE public.gym_info 
    ALTER COLUMN email SET DEFAULT 'pravinjoshi2707@gmail.com',
    ALTER COLUMN address SET DEFAULT 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra';

-- 2. Update existing singleton row in public.gym_info to the canonical email and address
UPDATE public.gym_info
SET email = 'pravinjoshi2707@gmail.com',
    address = 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
    updated_at = clock_timestamp();
