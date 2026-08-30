const ANNOUNCEMENT_REVIEW_STORAGE_KEY = "yingce.admin.announcements.pending-review";

export type AnnouncementPendingReview = {
    operation: "create" | "update" | "close";
    targetId?: string;
    previousTitle?: string;
    title: string;
    content: string;
    imageResourceId?: string;
    level: "info" | "success" | "warning" | "critical";
    pinned?: boolean;
    notice: string;
    requestedAt: string;
};

export function readAnnouncementPendingReview(): AnnouncementPendingReview | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.sessionStorage.getItem(ANNOUNCEMENT_REVIEW_STORAGE_KEY);
        if (!value) return null;
        const parsed = JSON.parse(value) as Partial<AnnouncementPendingReview>;
        if (
            (parsed.operation !== "create" && parsed.operation !== "update" && parsed.operation !== "close") ||
            typeof parsed.title !== "string" ||
            typeof parsed.content !== "string" ||
            (parsed.imageResourceId !== undefined && typeof parsed.imageResourceId !== "string") ||
            (parsed.level !== "info" && parsed.level !== "success" && parsed.level !== "warning" && parsed.level !== "critical") ||
            (parsed.pinned !== undefined && typeof parsed.pinned !== "boolean") ||
            typeof parsed.notice !== "string" ||
            !parsed.notice ||
            typeof parsed.requestedAt !== "string" ||
            Number.isNaN(new Date(parsed.requestedAt).getTime()) ||
            (parsed.targetId !== undefined && (typeof parsed.targetId !== "string" || !parsed.targetId)) ||
            (parsed.previousTitle !== undefined && typeof parsed.previousTitle !== "string") ||
            (parsed.operation !== "create" && (typeof parsed.targetId !== "string" || !parsed.targetId))
        )
            return null;
        return parsed as AnnouncementPendingReview;
    } catch {
        return null;
    }
}

export function writeAnnouncementPendingReview(review: AnnouncementPendingReview) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(ANNOUNCEMENT_REVIEW_STORAGE_KEY, JSON.stringify(review));
    } catch {
        // sessionStorage 可能被浏览器策略禁用；页内锁定仍然保持生效。
    }
}

export function clearAnnouncementPendingReview() {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(ANNOUNCEMENT_REVIEW_STORAGE_KEY);
    } catch {
        // 同上，不让存储策略影响已确认的界面操作。
    }
}
