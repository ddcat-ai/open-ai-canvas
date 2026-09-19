import type { CanvasTemplateDocument } from "@/lib/canvas/canvas-templates";
import { apiBaseURL, compactApiParams, http } from "@/services/api/request";

export type { CanvasTemplateDocument };

export type CanvasTemplateRecord = {
    id: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    status: "draft" | "published";
    visibility: "private" | "public";
    currentVersion: number;
    owned: boolean;
    source: "user" | "published";
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    document?: CanvasTemplateDocument;
};

export type CanvasTemplatePage = {
    templates: CanvasTemplateRecord[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export type SaveCanvasTemplateInput = Pick<CanvasTemplateRecord, "title" | "description" | "category" | "tags"> & { document: CanvasTemplateDocument };

export function listCanvasTemplates(options: { page?: number; pageSize?: number; query?: string; category?: string; signal?: AbortSignal } = {}) {
    return http.get<CanvasTemplatePage>("/canvas-templates", {
        signal: options.signal,
        params: compactApiParams({ page: options.page || 1, pageSize: options.pageSize || 40, q: options.query, category: options.category }),
    });
}

export function getCanvasTemplate(id: string) {
    return http.get<{ template: CanvasTemplateRecord }>(`/canvas-templates/${encodeURIComponent(id)}`);
}

export function canvasTemplateMediaURL(templateId: string, mediaId: string) {
    return `${String(apiBaseURL).replace(/\/+$/, "")}/canvas-templates/${encodeURIComponent(templateId)}/media/${encodeURIComponent(mediaId)}`;
}

export function createCanvasTemplate(input: SaveCanvasTemplateInput) {
    return http.post<{ template: CanvasTemplateRecord }>("/canvas-templates", input);
}

export function createCanvasTemplateVersion(id: string, input: SaveCanvasTemplateInput) {
    return http.post<{ template: CanvasTemplateRecord }>(`/canvas-templates/${encodeURIComponent(id)}/versions`, input);
}

export function deleteCanvasTemplate(id: string) {
    return http.delete<{ id: string }>(`/canvas-templates/${encodeURIComponent(id)}`);
}

export function listAdminCanvasTemplates(options: { page?: number; pageSize?: number; query?: string; status?: string; signal?: AbortSignal } = {}) {
    return http.get<CanvasTemplatePage>("/admin/canvas-templates", {
        signal: options.signal,
        params: compactApiParams({ page: options.page || 1, pageSize: options.pageSize || 40, q: options.query, status: options.status }),
    });
}

export function updateAdminCanvasTemplate(id: string, input: { status: "draft" | "published"; visibility: "private" | "public" }) {
    return http.patch<{ template: CanvasTemplateRecord }>(`/admin/canvas-templates/${encodeURIComponent(id)}`, input);
}
