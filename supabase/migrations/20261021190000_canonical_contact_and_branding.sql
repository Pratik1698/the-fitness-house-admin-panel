-- ============================================================================
-- Migration: 20261021190000_canonical_contact_and_branding.sql
-- Description: Sets canonical gym contact (+91 7385846525) and branding (Pravin Joshi)
-- Safety: Preserves existing accounts, UUIDs, roles, notifications, and audit logs
-- ============================================================================

-- 1. Update column defaults on public.gym_info
ALTER TABLE public.gym_info 
    ALTER COLUMN phone SET DEFAULT '+91 7385846525',
    ALTER COLUMN email SET DEFAULT 'contact@thefitnesshouse.in',
    ALTER COLUMN address SET DEFAULT 'Main Road, Arag, Tal. Panhala, Dist. Kolhapur, Maharashtra';

-- 2. Upsert / update canonical singleton row in public.gym_info
INSERT INTO public.gym_info (
    name, tagline, address, phone, email, currency_code, currency_symbol
)
SELECT 
    'The Fitness House',
    'Gym Management',
    'Main Road, Arag, Tal. Panhala, Dist. Kolhapur, Maharashtra',
    '+91 7385846525',
    'contact@thefitnesshouse.in',
    'INR',
    '₹'
WHERE NOT EXISTS (SELECT 1 FROM public.gym_info);

UPDATE public.gym_info
SET phone = '+91 7385846525',
    email = 'contact@thefitnesshouse.in',
    address = 'Main Road, Arag, Tal. Panhala, Dist. Kolhapur, Maharashtra',
    updated_at = clock_timestamp()
WHERE phone = '+91 98765 43210' OR phone IS NULL;

-- 3. Ensure canonical trainer record exists in public.trainers
INSERT INTO public.trainers (name, specialty, phone, is_active)
SELECT 
    'Coach Pravin Joshi',
    'Head Coach - Strength & Conditioning',
    '+91 7385846525',
    true
WHERE NOT EXISTS (
    SELECT 1 FROM public.trainers WHERE name ILIKE '%Pravin Joshi%'
);
