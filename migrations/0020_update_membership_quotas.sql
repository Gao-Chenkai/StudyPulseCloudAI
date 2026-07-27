-- Migration number: 0020  2026-07-27T00:00:00.000Z
--
-- Update membership quotas for the current pricing tiers.

UPDATE membership_plans
   SET daily_request_limit = 5,
       monthly_token_limit = 10000
 WHERE id = 'free';

UPDATE membership_plans
   SET daily_request_limit = 50,
       monthly_token_limit = 200000
 WHERE id = 'plus';

UPDATE membership_plans
   SET daily_request_limit = 200,
       monthly_token_limit = 1500000
 WHERE id = 'pro';
