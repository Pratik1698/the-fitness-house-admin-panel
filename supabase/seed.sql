-- ============================================================================
-- THE FITNESS HOUSE — SEED CONFIGURATION FOR LOCAL & HOSTED RESET
-- File: supabase/seed.sql
-- ============================================================================
-- Purpose:
-- Provides deterministic, idempotent baseline data for initial setup after
-- a clean database rebuild or reset.
--
-- Contains:
-- 1. Canonical Gym Information (The Fitness House)
-- 2. Core Membership Plans
-- 3. Default Reminder Settings
-- 4. Initial Production Profile Bootstrapping (Admin & Staff)
-- ============================================================================

-- 1. CANONICAL GYM INFORMATION (Singleton Pattern)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.gym_info) THEN
        UPDATE public.gym_info
        SET name = 'The Fitness House',
            tagline = 'Transform Your Body, Transform Your Life',
            phone = '+91 73858 46525',
            email = 'pravinjoshi2707@gmail.com',
            address = 'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
            currency_symbol = '₹',
            currency_code = 'INR',
            updated_at = clock_timestamp();
    ELSE
        INSERT INTO public.gym_info (
            name,
            tagline,
            phone,
            email,
            address,
            currency_symbol,
            currency_code
        )
        VALUES (
            'The Fitness House',
            'Transform Your Body, Transform Your Life',
            '+91 73858 46525',
            'pravinjoshi2707@gmail.com',
            'Near Vitthal Mandir, Arag, Tal. Miraj, Dist. Sangli, Maharashtra',
            '₹',
            'INR'
        );
    END IF;
END $$;

-- 2. CORE MEMBERSHIP PLANS
INSERT INTO public.membership_plans (id, name, duration_days, price, is_active)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Monthly Plan', 30, 700.00, true),
    ('a0000000-0000-0000-0000-000000000002', 'Quarterly Plan', 90, 2000.00, true),
    ('a0000000-0000-0000-0000-000000000003', 'Half Yearly Plan', 180, 4000.00, true),
    ('a0000000-0000-0000-0000-000000000004', 'Annual Plan', 365, 8000.00, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    duration_days = EXCLUDED.duration_days,
    price = EXCLUDED.price,
    is_active = EXCLUDED.is_active;

-- 3. DEFAULT REMINDER SETTINGS
INSERT INTO public.reminder_settings (
    singleton_guard,
    five_day,
    three_day,
    one_day,
    expiry_day,
    payment_alerts,
    auto_whatsapp
)
VALUES (
    true,
    true,
    true,
    true,
    true,
    true,
    false
)
ON CONFLICT (singleton_guard) DO UPDATE SET
    five_day = EXCLUDED.five_day,
    three_day = EXCLUDED.three_day,
    one_day = EXCLUDED.one_day,
    expiry_day = EXCLUDED.expiry_day,
    payment_alerts = EXCLUDED.payment_alerts,
    auto_whatsapp = EXCLUDED.auto_whatsapp,
    updated_at = clock_timestamp();

-- 4. CONFIRMED ADMINISTRATOR PROFILE BOOTSTRAPPING
-- Dynamically matches by confirmed administrator email address so newly generated UUIDs
-- from Supabase Auth are safely linked without hardcoded ID dependencies.
-- NOTE: Staff accounts (e.g. pratikp5598@gmail.com) are intentionally NOT bootstrapped here;
-- they must be invited by an active administrator via create_staff_invitation() and complete
-- the Phase 5 invitation acceptance lifecycle.
DO $$
BEGIN
    -- Bootstrapping Primary Administrator Profile (if auth user exists for confirmed admin email)
    INSERT INTO public.profiles (id, email, full_name, role, is_active, deactivated_at)
    SELECT
        id,
        email,
        COALESCE(raw_user_meta_data->>'full_name', 'The Fitness House Admin'),
        'admin',
        true,
        NULL
    FROM auth.users
    WHERE lower(trim(email)) = 'pravinjoshi2707@gmail.com'
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = 'admin',
        is_active = true,
        deactivated_at = NULL,
        updated_at = clock_timestamp();
END $$;
