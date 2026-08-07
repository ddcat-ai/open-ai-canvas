import { apiClient, request } from "@/services/api/request";

export type AnnouncementLevel = "info" | "success" | "warning" | "critical";
export type AnnouncementStatus = "active" | "closed";

export type SystemAnnouncement = {
    id: string;
    title: string;
    content: string;
    level: AnnouncementLevel;
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

export function markAnnouncementsRead(announcementIds: string[]) {
    return request<{ unreadCount: number }>(api.post("/announcements/read", { announcementIds }));
}

export function listAdminAnnouncements(params: AdminAnnouncementListParams = {}) {
    return request<{ announcements: SystemAnnouncement[]; total: number; page: number; limit: number }>(api.get("/admin/announcements", { params }));
}

export function createAdminAnnouncement(input: { title: string; content: string; level: AnnouncementLevel }) {
    return request<{ announcement: SystemAnnouncement }>(api.post("/admin/announcements", input));
}

export function updateAdminAnnouncement(id: string, input: { title: string; content: string; level: AnnouncementLevel }) {
    return request<{ announcement: SystemAnnouncement }>(api.patch(`/admin/announcements/${encodeURIComponent(id)}`, input));
}

export function closeAdminAnnouncement(id: string) {
    return request<{ announcement: SystemAnnouncement }>(api.post(`/admin/announcements/${encodeURIComponent(id)}/close`));
}
