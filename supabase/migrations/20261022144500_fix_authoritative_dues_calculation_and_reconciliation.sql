-- ============================================================================
-- THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
-- Migration: 20261022144500_fix_authoritative_dues_calculation_and_reconciliation.sql
--
-- Objective:
-- 1. Replace non-idempotent relative accumulation (amount_paid = amount_paid + NEW.amount)
--    in fn_sync_payment_balances() with authoritative aggregation from public.payments ledger.
-- 2. Extend trigger trg_sync_payment_balances to AFTER INSERT OR UPDATE OR DELETE on payments.
-- 3. If an UPDATE changes subscription_id or pt_assignment_id, recalculate both OLD and NEW records.
-- 4. Idempotently reconcile any historical member_subscriptions records whose amount_paid
--    or credit_adjustments deviate from completed payment ledger totals.
--
-- Business Rules Enforced:
-- - public.payments is the single source of truth for all payments, refunds, and credits.
-- - amount_paid = SUM(completed payments) - SUM(completed refunds)
-- - credit_adjustments = SUM(completed credit adjustments)
-- - balance = GREATEST(0.00, (plan_price + previous_balance_carried) - amount_paid - balance_transferred_out - credit_adjustments)
-- - payment_status = 'paid' when balance <= 0, 'partial' when amount_paid > 0, else 'unpaid'.
-- ============================================================================

BEGIN;

-- 1. Authoritative Financial Balance Synchronization Trigger Function
CREATE OR REPLACE FUNCTION public.fn_sync_payment_balances()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub_id uuid;
    v_pt_id uuid;
    v_sub_ids uuid[] := ARRAY[]::uuid[];
    v_pt_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    -- Collect all affected subscription IDs (both NEW and OLD)
    IF TG_OP = 'INSERT' THEN
        IF NEW.subscription_id IS NOT NULL THEN
            v_sub_ids := ARRAY[NEW.subscription_id];
        END IF;
        IF NEW.pt_assignment_id IS NOT NULL THEN
            v_pt_ids := ARRAY[NEW.pt_assignment_id];
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.subscription_id IS NOT NULL THEN
            v_sub_ids := ARRAY[OLD.subscription_id];
        END IF;
        IF OLD.pt_assignment_id IS NOT NULL THEN
            v_pt_ids := ARRAY[OLD.pt_assignment_id];
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.subscription_id IS NOT NULL THEN
            v_sub_ids := array_append(v_sub_ids, NEW.subscription_id);
        END IF;
        IF OLD.subscription_id IS NOT NULL AND OLD.subscription_id IS DISTINCT FROM NEW.subscription_id THEN
            v_sub_ids := array_append(v_sub_ids, OLD.subscription_id);
        END IF;

        IF NEW.pt_assignment_id IS NOT NULL THEN
            v_pt_ids := array_append(v_pt_ids, NEW.pt_assignment_id);
        END IF;
        IF OLD.pt_assignment_id IS NOT NULL AND OLD.pt_assignment_id IS DISTINCT FROM NEW.pt_assignment_id THEN
            v_pt_ids := array_append(v_pt_ids, OLD.pt_assignment_id);
        END IF;
    END IF;

    -- 1. Synchronize all affected Member Subscriptions
    FOREACH v_sub_id IN ARRAY v_sub_ids
    LOOP
        UPDATE public.member_subscriptions
        SET amount_paid = COALESCE((
                SELECT SUM(
                    CASE 
                        WHEN transaction_type = 'payment' THEN amount
                        WHEN transaction_type = 'refund' THEN -amount
                        ELSE 0.00
                    END
                )
                FROM public.payments
                WHERE subscription_id = v_sub_id
                  AND status = 'completed'
            ), 0.00),
            credit_adjustments = COALESCE((
                SELECT SUM(amount)
                FROM public.payments
                WHERE subscription_id = v_sub_id
                  AND transaction_type = 'credit_adjustment'
                  AND status = 'completed'
            ), 0.00),
            updated_at = clock_timestamp()
        WHERE id = v_sub_id;
    END LOOP;

    -- 2. Synchronize all affected Personal Training Assignments
    FOREACH v_pt_id IN ARRAY v_pt_ids
    LOOP
        UPDATE public.pt_assignments
        SET amount_paid = COALESCE((
                SELECT SUM(
                    CASE 
                        WHEN transaction_type = 'payment' THEN amount
                        WHEN transaction_type = 'refund' THEN -amount
                        ELSE 0.00
                    END
                )
                FROM public.payments
                WHERE pt_assignment_id = v_pt_id
                  AND status = 'completed'
            ), 0.00),
            credit_adjustments = COALESCE((
                SELECT SUM(amount)
                FROM public.payments
                WHERE pt_assignment_id = v_pt_id
                  AND transaction_type = 'credit_adjustment'
                  AND status = 'completed'
            ), 0.00),
            updated_at = clock_timestamp()
        WHERE id = v_pt_id;
    END LOOP;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Ensure Trigger Listens to All Ledger Modifications (INSERT, UPDATE, DELETE)
DROP TRIGGER IF EXISTS trg_sync_payment_balances ON public.payments;
CREATE TRIGGER trg_sync_payment_balances
    AFTER INSERT OR UPDATE OR DELETE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_payment_balances();

-- 3. Idempotently Reconcile Historical Subscription Balances
UPDATE public.member_subscriptions ms
SET amount_paid = COALESCE((
        SELECT SUM(
            CASE 
                WHEN p.transaction_type = 'payment' THEN p.amount
                WHEN p.transaction_type = 'refund' THEN -p.amount
                ELSE 0.00
            END
        )
        FROM public.payments p
        WHERE p.subscription_id = ms.id
          AND p.status = 'completed'
    ), 0.00),
    credit_adjustments = COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.subscription_id = ms.id
          AND p.transaction_type = 'credit_adjustment'
          AND p.status = 'completed'
    ), 0.00),
    updated_at = clock_timestamp()
WHERE ms.amount_paid <> COALESCE((
        SELECT SUM(
            CASE 
                WHEN p.transaction_type = 'payment' THEN p.amount
                WHEN p.transaction_type = 'refund' THEN -p.amount
                ELSE 0.00
            END
        )
        FROM public.payments p
        WHERE p.subscription_id = ms.id
          AND p.status = 'completed'
    ), 0.00)
   OR ms.credit_adjustments <> COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.subscription_id = ms.id
          AND p.transaction_type = 'credit_adjustment'
          AND p.status = 'completed'
    ), 0.00);

-- 4. Idempotently Reconcile Historical Personal Training Balances (Safety Check)
UPDATE public.pt_assignments pa
SET amount_paid = COALESCE((
        SELECT SUM(
            CASE 
                WHEN p.transaction_type = 'payment' THEN p.amount
                WHEN p.transaction_type = 'refund' THEN -p.amount
                ELSE 0.00
            END
        )
        FROM public.payments p
        WHERE p.pt_assignment_id = pa.id
          AND p.status = 'completed'
    ), 0.00),
    credit_adjustments = COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.pt_assignment_id = pa.id
          AND p.transaction_type = 'credit_adjustment'
          AND p.status = 'completed'
    ), 0.00),
    updated_at = clock_timestamp()
WHERE pa.amount_paid <> COALESCE((
        SELECT SUM(
            CASE 
                WHEN p.transaction_type = 'payment' THEN p.amount
                WHEN p.transaction_type = 'refund' THEN -p.amount
                ELSE 0.00
            END
        )
        FROM public.payments p
        WHERE p.pt_assignment_id = pa.id
          AND p.status = 'completed'
    ), 0.00)
   OR pa.credit_adjustments <> COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        WHERE p.pt_assignment_id = pa.id
          AND p.transaction_type = 'credit_adjustment'
          AND p.status = 'completed'
    ), 0.00);

COMMIT;
