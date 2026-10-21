-- ============================================================================
-- Clean up all disposable test fixtures created for WhatsApp verification
-- ============================================================================
BEGIN;

DELETE FROM public.notifications 
WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-WA-%');

DELETE FROM public.member_subscriptions 
WHERE member_id IN (SELECT id FROM public.members WHERE member_code LIKE 'TEST-WA-%');

DELETE FROM public.members 
WHERE member_code LIKE 'TEST-WA-%';

COMMIT;
