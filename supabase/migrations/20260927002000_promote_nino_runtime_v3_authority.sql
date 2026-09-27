-- Finalize Nino Runtime V3 semantic authority in production configuration.
-- V3 owns interpretation for 100% of users; V2 remains only as the runtime
-- circuit breaker inside ConversationAuthority when V3 cannot emit/bridge a
-- safe contract. Production shadow evaluation is retired.

INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('runtime_v3_authority_v1', true, 100, '{}'::uuid[]),
  ('runtime_v3_shadow', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    rollout_percent = EXCLUDED.rollout_percent,
    pilot_user_ids = EXCLUDED.pilot_user_ids;
