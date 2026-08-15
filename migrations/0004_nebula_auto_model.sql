-- Phase 03 provider routing correction. Keep the canonical editable agent
-- configuration aligned with the runtime's verified Nebula model setting.
UPDATE agent_configurations
SET model_key = 'auto'
WHERE is_active = 1
  AND provider_role = 'normal_agent';
