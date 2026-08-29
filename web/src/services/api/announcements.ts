import { apiBaseURL, apiClient, request } from "@/services/api/request";
import type { RemoteResource } from "@/services/api/resources";

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
    limit?: number;
};

const api = apiClient;

export function getAnnouncementFeed() {
    return request<AnnouncementFeed>(api.get("/announcements"));
}

export function announcementImageUrl(announcement: Pick<SystemAnnouncement, "imageUrl">) {
    const imageUrl = announcement.imageUrl;
    if (!imageUrl || !imageUrl.startsWith("/api/")) return imageUrl || "";
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return base === "/api" ? imageUrl : `${base}${imageUrl.slice("/api".length)}`;
}

export function markAnnouncementsRead(announcementIds: string[]) {
    return request<{ unreadCount: number }>(api.post("/announcements/read", { announcementIds }));
}

export function listAdminAnnouncements(params: AdminAnnouncementListParams = {}) {
    return request<{ announcements: SystemAnnouncement[]; total: number; page: number; limit: number }>(api.get("/admin/announcements", { params }));
}

export function uploadAdminAnnouncementImage(file: File) {
    const formData = new FormData();
    formData.append("file", file, file.name);
    return request<{ resource: RemoteResource }>(api.post("/admin/announcement-images", formData));
}

export function discardAdminAnnouncementImage(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/announcement-images/${encodeURIComponent(id)}`));
}

export function createAdminAnnouncement(input: { title: string; content: string; imageResourceId?: string; level: AnnouncementLevel; pinned: boolean }) {
    return request<{ announcement: SystemAnnouncement }>(api.post("/admin/announcements", input));
}

export function updateAdminAnnouncement(id: string, input: { title: string; content: string; imageResourceId?: string; level: AnnouncementLevel; pinned: boolean }) {
    return request<{ announcement: SystemAnnouncement }>(api.patch(`/admin/announcements/${encodeURIComponent(id)}`, input));
}

export function closeAdminAnnouncement(id: string) {
    return request<{ announcement: SystemAnnouncement }>(api.post(`/admin/announcements/${encodeURIComponent(id)}/close`));
}
