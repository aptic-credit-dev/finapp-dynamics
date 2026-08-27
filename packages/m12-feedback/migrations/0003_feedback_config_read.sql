-- ---------------------------------------------------------------------------------------------------
-- M12 — read permissions for the two write-only setup catalogues (categories, source systems). The
-- questionnaire and SLA-policy specs already ship `feedback.questionnaire.read` / `feedback.sla.read`, but
-- categories and source systems were created write-only (manage-only) in 0001. A read-only auditor cannot
-- inspect config without holding a `.manage` (write) grant — a least-privilege gap. These two non-privileged
-- read codes back the new canonical list routes and let the Auditor / read-only personas view setup without
-- any write capability. Additive only (ON CONFLICT DO NOTHING); no table, RLS or grant change. (ADR-052 — no
-- vague `feedback.admin`; every code is a concrete three-segment `feedback.<entity>.<action>`.)
-- ---------------------------------------------------------------------------------------------------

INSERT INTO permissions (code, module, resource_type, privileged) VALUES
  ('feedback.category.read', 'm12-feedback', 'feedback_category', false),
  ('feedback.source.read', 'm12-feedback', 'feedback_source_system', false)
ON CONFLICT (code) DO NOTHING;
