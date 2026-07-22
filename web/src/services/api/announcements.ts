import axios from "axios";

import type { BackendEnvelope } from "@/services/api/task-center";

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

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    const response = await promise;
    if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
    return response.data.data;
}

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

export function closeAdminAnnouncement(id: string) {
    return request<{ announcement: SystemAnnouncement }>(api.post(`/admin/announcements/${encodeURIComponent(id)}/close`));
}
