// 公告接口返回值的校验与待复核操作识别。
//
// 写接口返回不确定（网络中断、超时）时不能假装成功：列入待复核，由管理员刷新确认。

import { ApiError } from "@/services/api/request";
import { type AnnouncementLevel, type AnnouncementStatus, listAdminAnnouncements, type SystemAnnouncement } from "@/services/api/announcements";
import type { AnnouncementPendingReview } from "./admin-announcement-safety";

export type AnnouncementFormValues = {
    title: string;
    content: string;
    imageResourceId?: string;
    level: AnnouncementLevel;
    pinned: boolean;
};

export type PendingAnnouncement =
    | (AnnouncementFormValues & { mode: "create" })
    | (AnnouncementFormValues & {
          mode: "update";
          id: string;
          previousStatus: AnnouncementStatus;
          previousPublishedAt: string;
          previousTitle: string;
      });

export const DEFAULT_ANNOUNCEMENT: AnnouncementFormValues = { title: "", content: "", imageResourceId: "", level: "info", pinned: false };

export const levelOptions: Array<{ value: AnnouncementLevel; label: string }> = [
    { value: "info", label: "平台通知" },
    { value: "success", label: "状态恢复" },
    { value: "warning", label: "服务提醒" },
    { value: "critical", label: "重要通知" },
];

export const levelMeta: Record<AnnouncementLevel, { label: string; tone: "info" | "success" | "warning" | "error"; guidance: string }> = {
    info: { label: "平台通知", tone: "info", guidance: "常规功能、活动或规则说明。" },
    success: { label: "状态恢复", tone: "success", guidance: "此前受影响的服务已经恢复。" },
    warning: { label: "服务提醒", tone: "warning", guidance: "可能影响使用，需要用户留意。" },
    critical: { label: "重要通知", tone: "error", guidance: "高优先级事件或必须执行的操作。" },
};

export function formatDateTime(value?: string | null) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}

export function isMutationResultUncertain(error: unknown) {
    if (!(error instanceof ApiError)) return true;
    return error.status === undefined || error.retryable || error.status >= 500;
}

export function assertAnnouncementMutationResult(
    result: unknown,
    expectedStatus: AnnouncementStatus,
    expectedId: string | undefined,
    expectedContent: Pick<SystemAnnouncement, "title" | "content" | "level" | "pinned"> & Pick<Partial<SystemAnnouncement>, "imageResourceId">,
) {
    const announcement = (result as { announcement?: Partial<SystemAnnouncement> } | null)?.announcement;
    const publishedAt = announcement?.publishedAt;
    const closedAt = announcement?.closedAt;
    const validPublishedAt = typeof publishedAt === "string" && !Number.isNaN(new Date(publishedAt).getTime());
    const validClosedAt = expectedStatus === "closed" ? typeof closedAt === "string" && !Number.isNaN(new Date(closedAt).getTime()) : closedAt === null || closedAt === undefined;
    const contentMatches =
        announcement?.title === expectedContent.title &&
        announcement?.content === expectedContent.content &&
        announcement?.level === expectedContent.level &&
        announcement?.pinned === expectedContent.pinned &&
        (announcement?.imageResourceId || "") === (expectedContent.imageResourceId || "");
    if (!announcement || typeof announcement.id !== "string" || !announcement.id || (expectedId && announcement.id !== expectedId) || announcement.status !== expectedStatus || !validPublishedAt || !validClosedAt || !contentMatches) {
        throw new Error("服务返回的公告状态不完整，无法确认操作结果");
    }
}

export function assertAnnouncementListResult(result: unknown, expectedPage: number, expectedPageSize: number) {
    if (!isRecord(result) || !Array.isArray(result.announcements) || !Number.isInteger(result.total) || (result.total as number) < 0 || result.page !== expectedPage || result.pageSize !== expectedPageSize) {
        throw new Error("公告列表返回格式不完整");
    }
    const announcements = result.announcements.map((value) => normalizeAnnouncementListItem(value));
    if ((result.total as number) < announcements.length) throw new Error("公告列表总数与当前页数据不一致");
    return { announcements, total: result.total as number, page: expectedPage, pageSize: expectedPageSize };
}

export function normalizeAnnouncementListItem(value: unknown): SystemAnnouncement {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !value.id ||
        typeof value.title !== "string" ||
        typeof value.content !== "string" ||
        !isKnownAnnouncementLevel(value.level) ||
        !isKnownAnnouncementStatus(value.status) ||
        typeof value.pinned !== "boolean" ||
        (value.imageResourceId !== null && value.imageResourceId !== undefined && typeof value.imageResourceId !== "string") ||
        (value.imageUrl !== null && value.imageUrl !== undefined && typeof value.imageUrl !== "string") ||
        typeof value.createdBy !== "string" ||
        !isValidDateTimeString(value.publishedAt) ||
        !isValidDateTimeString(value.createdAt) ||
        !isValidDateTimeString(value.updatedAt) ||
        (value.closedAt !== null && value.closedAt !== undefined && !isValidDateTimeString(value.closedAt))
    ) {
        throw new Error("公告列表包含无法识别的记录");
    }
    return {
        id: value.id,
        title: value.title,
        content: value.content,
        imageResourceId: typeof value.imageResourceId === "string" ? value.imageResourceId : undefined,
        imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : undefined,
        level: value.level,
        pinned: value.pinned,
        status: value.status,
        createdBy: value.createdBy,
        publishedAt: value.publishedAt as string,
        closedAt: typeof value.closedAt === "string" ? value.closedAt : undefined,
        createdAt: value.createdAt as string,
        updatedAt: value.updatedAt as string,
    };
}

export async function inspectPendingReview(review: AnnouncementPendingReview) {
    const queryTitles = Array.from(new Set([review.title, review.previousTitle].filter((value): value is string => Boolean(value?.trim()))));
    const candidates = new Map<string, SystemAnnouncement>();
    for (const title of queryTitles) {
        let targetPage = 1;
        while (targetPage <= 50) {
            const data = assertAnnouncementListResult(await listAdminAnnouncements({ keyword: title, page: targetPage, pageSize: 100 }), targetPage, 100);
            data.announcements.forEach((announcement) => candidates.set(announcement.id, announcement));
            if (targetPage >= Math.max(1, Math.ceil(data.total / data.pageSize))) break;
            if (targetPage === 50) throw new Error("同名匹配记录过多，无法安全定位目标；请稍后重试。");
            targetPage += 1;
        }
    }

    const records = Array.from(candidates.values());
    if (review.targetId) {
        const target = records.find((announcement) => announcement.id === review.targetId);
        if (!target) return `按请求前后标题检索后，未找到目标 ID ${review.targetId}。该请求可能未生效，请结合完整列表再人工确认。`;
        const contentMatches =
            target.title === review.title &&
            target.content === review.content &&
            target.level === review.level &&
            (review.pinned === undefined || target.pinned === review.pinned) &&
            (review.imageResourceId === undefined || (target.imageResourceId || "") === review.imageResourceId);
        const expectedStatus: AnnouncementStatus = review.operation === "close" ? "closed" : "active";
        const statusMatches = target.status === expectedStatus;
        return `已定位目标 ID ${target.id}：当前为${target.status === "active" ? "发布中" : "已关闭"}，标题、正文与类型${contentMatches ? "与请求一致" : "与请求不一致"}，${statusMatches ? "状态符合预期" : "状态不符合预期"}。`;
    }

    const requestedAt = new Date(review.requestedAt).getTime();
    const matchingRecords = records.filter(
        (announcement) =>
            announcement.title === review.title &&
            announcement.content === review.content &&
            announcement.level === review.level &&
            (review.pinned === undefined || announcement.pinned === review.pinned) &&
            (review.imageResourceId === undefined || (announcement.imageResourceId || "") === review.imageResourceId) &&
            new Date(announcement.publishedAt).getTime() >= requestedAt - 5 * 60_000,
    );
    if (!matchingRecords.length) return "未找到请求时间附近与标题、正文和类型完全一致的新公告；该发布请求可能未生效。";
    const resultSummary = matchingRecords
        .slice(0, 3)
        .map((announcement) => `${announcement.id} · ${formatDateTime(announcement.publishedAt)} · ${announcement.status === "active" ? "发布中" : "已关闭"}`)
        .join("；");
    return `找到 ${matchingRecords.length} 条与请求内容完全一致的近期记录：${resultSummary}${matchingRecords.length > 3 ? "；其余记录请在列表中核对" : ""}。`;
}

export function formatPendingReviewOperation(operation: AnnouncementPendingReview["operation"]) {
    if (operation === "create") return "发布新公告";
    if (operation === "update") return "编辑并重新发布";
    return "关闭公告";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}

export function isValidDateTimeString(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

export function isKnownAnnouncementLevel(value: unknown): value is AnnouncementLevel {
    return value === "info" || value === "success" || value === "warning" || value === "critical";
}

export function isKnownAnnouncementStatus(value: unknown): value is AnnouncementStatus {
    return value === "active" || value === "closed";
}
