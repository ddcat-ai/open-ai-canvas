import { currentLocale, translate } from "@/i18n";
import { DEFAULT_LOCALE } from "@/i18n/locales";

/**
 * 后端稳定错误原因（backend/internal/kernel/error_codes.go 的 ErrorReason）。
 * 页面应按 reason / code 分支，不要解析 msg。
 */
export const API_ERROR_REASONS = [
    "invalid_argument",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "project_name_conflict",
    "skill_version_conflict",
    "canvas_history_resources_missing",
    "failed_precondition",
    "quota_exceeded",
    "storage_capacity_exceeded",
    "storage_read_only",
    "drama_budget_exhausted",
    "drama_segment_changed",
    "drama_episode_confirm_required",
    "agent_interjection_run_finished",
    "agent_interjection_already_delivered",
    "agent_run_state_busy",
    "rate_limited",
    "unavailable",
    "timeout",
    "internal",
    "bad_gateway",
    "upstream_dns_failed",
] as const;

export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];

// 这些原因的含义足够明确，非中文界面可直接用本地化文案替换后端中文 msg；
// 其他原因（invalid_argument、conflict 等）的具体信息只在 msg 里，保留原文。
const LOCALIZED_REASONS = new Set<string>(["unauthorized", "forbidden", "not_found", "rate_limited", "quota_exceeded", "storage_capacity_exceeded", "storage_read_only", "unavailable", "timeout", "bad_gateway", "upstream_dns_failed", "internal"]);

/** 返回面向用户的错误文案：中文界面保留后端原文，其他语言对明确的 reason 使用本地化文案。 */
export function localizedApiErrorMessage(reason: string | undefined, fallback: string): string {
    if (!reason || currentLocale() === DEFAULT_LOCALE || !LOCALIZED_REASONS.has(reason)) return fallback;
    return translate(`errors.reason.${reason}`);
}
