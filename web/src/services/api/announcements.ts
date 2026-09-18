import { http, apiBaseURL } from "@/services/api/request";
import type { RemoteResource } from "@/services/api/resources";
import type { BannerNoticeType } from "@/lib/announcements/banner-notice";
import type { BannerTitleRun } from "@/lib/announcements/banner-title";

export type { BannerTitleRun };

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";
export type AnnouncementStatus = "active" | "closed";

export type SystemAnnouncement = {
    id: string;
    title: string;
    content: string;
    imageResourceId?: string;
    imageUrl?: string;
    level: AnnouncementLevel;
    pinned: boolean;
    status: AnnouncementStatus;
    createdBy: string;
    publishedAt: string;
    closedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type AnnouncementFeed = {
    announcements: SystemAnnouncement[];
    unreadCount: number;
};

export type AdminAnnouncementListParams = {
    keyword?: string;
    status?: AnnouncementStatus;
    page?: number;
    pageSize?: number;
};


export function getAnnouncementFeed() {
    return http.get<AnnouncementFeed>("/announcements");
}

export function announcementImageUrl(announcement: Pick<SystemAnnouncement, "imageUrl">) {
    const imageUrl = announcement.imageUrl;
    if (!imageUrl || !imageUrl.startsWith("/api/")) return imageUrl || "";
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return base === "/api" ? imageUrl : `${base}${imageUrl.slice("/api".length)}`;
}

export function markAnnouncementsRead(announcementIds: string[]) {
    return http.post<{ unreadCount: number }>("/announcements/read", { announcementIds });
}

export function listAdminAnnouncements(params: AdminAnnouncementListParams = {}) {
    return http.get<{ announcements: SystemAnnouncement[]; total: number; page: number; pageSize: number }>("/admin/announcements", { params });
}

export function uploadAdminAnnouncementImage(file: File) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    return http.post<{ resource: RemoteResource }>("/admin/announcement-images", formData);
}

export function discardAdminAnnouncementImage(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/announcement-images/${encodeURIComponent(id)}`);
}

export function createAdminAnnouncement(input: { title: string; content: string; imageResourceId?: string; level: AnnouncementLevel; pinned: boolean }) {
    return http.post<{ announcement: SystemAnnouncement }>("/admin/announcements", input);
}

export function updateAdminAnnouncement(id: string, input: { title: string; content: string; imageResourceId?: string; level: AnnouncementLevel; pinned: boolean }) {
    return http.patch<{ announcement: SystemAnnouncement }>(`/admin/announcements/${encodeURIComponent(id)}`, input);
}

export function closeAdminAnnouncement(id: string) {
    return http.post<{ announcement: SystemAnnouncement }>(`/admin/announcements/${encodeURIComponent(id)}/close`);
}

export type BannerAnnouncement = {
    id: string;
    title: string;
    /** 标题样式分段；为空表示纯文本标题（取值白名单见 lib/announcements/banner-title）。 */
    titleRuns?: BannerTitleRun[];
    /** 通知类型，决定通知条底色；未知值按「公告」处理。 */
    noticeType?: BannerNoticeType;
    link?: string;
    status: "active" | "disabled";
    startsAt?: string;
    endsAt?: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminBannerListParams = {
    keyword?: string;
    status?: string;
    page?: number;
    pageSize?: number;
};

export type AdminBannerPayload = {
    title: string;
    titleRuns?: BannerTitleRun[];
    noticeType?: BannerNoticeType;
    link?: string;
    status: "active" | "disabled";
    startsAt?: string;
    endsAt?: string;
};

export function getActiveBanners() {
    return http.get<{ banners: BannerAnnouncement[] }>("/banner-announcements");
}

export function listAdminBanners(params: AdminBannerListParams = {}) {
    return http.get<{ banners: BannerAnnouncement[]; total: number; page: number; pageSize: number }>("/admin/banner-announcements", { params });
}

export function createAdminBanner(input: AdminBannerPayload) {
    return http.post<{ banner: BannerAnnouncement }>("/admin/banner-announcements", input);
}

export function updateAdminBanner(id: string, input: AdminBannerPayload) {
    return http.put<{ banner: BannerAnnouncement }>(`/admin/banner-announcements/${encodeURIComponent(id)}`, input);
}

export function deleteAdminBanner(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/banner-announcements/${encodeURIComponent(id)}`);
}
