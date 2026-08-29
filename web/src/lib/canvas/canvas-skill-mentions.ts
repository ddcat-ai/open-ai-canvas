/**
 * Compatibility exports for canvas mention UI.
 *
 * Skill selection and delivery are owned by the shared Skill Runtime service;
 * canvas code must not load files or expand skill prompts independently.
 */
export { buildSkillMentionReferences, resolveSkillMentions } from "@/services/skill-runtime";
