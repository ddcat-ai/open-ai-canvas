import { http, compactApiParams, serializeApiParams, type ApiParams, type HttpRequestConfig } from "@/services/api/request";

export type ToolType = "style" | "motion" | "nine_grid" | "effect";
export type ToolScope = "public" | "favorites" | "custom";
export type ToolSource = "builtin" | "user";
export type ToolVisibility = "public" | "private";

// 列表摘要项：不含 prompt、extraInfo 等大字段
export type ToolSummary = {
    id: number;
    type: ToolType | string;
    labelEn: string;
    label: string;
    desc: string;
    tag: string;
    cover: string;
    ratio: string;
    mediaUrl: string;
    ownerId: string;
    source: ToolSource | string;
    enabled: boolean;
    visibility: ToolVisibility | string;
    sortWeight: number;
    favorited: boolean;
    createdAt: string;
    updatedAt: string;
};

// 详情/写操作返回的完整工具
export type ToolItem = ToolSummary & {
    extraInfo: string[];
    prompt: string;
};

export type ToolList = {
    tools: ToolSummary[];
    totalCount: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
};

export type ListToolsInput = {
    page?: number;
    pageSize?: number;
    scope?: ToolScope;
    type?: ToolType | string;
    tag?: string;
    search?: string;
};

export type ToolMutationInput = {
    type: ToolType | string;
    label: string;
    desc?: string;
    tag?: string;
    cover?: string;
    extraInfo?: string[];
    prompt: string;
    ratio?: string;
    mediaUrl?: string;
    visibility?: ToolVisibility;
};

export function listTools(input: ListToolsInput = {}, config?: HttpRequestConfig) {
    const params = serializeApiParams(compactApiParams(input as ApiParams));
    return http.get<ToolList>(`/tools?${params.toString()}`, config);
}

export function getTool(id: number, config?: HttpRequestConfig) {
    return http.get<ToolItem>(`/tools/${encodeURIComponent(String(id))}`, config);
}

export function setToolFavorite(id: number, favorite: boolean) {
    return favorite ? http.post<ToolItem>(`/tools/${encodeURIComponent(String(id))}/favorite`) : http.delete<ToolItem>(`/tools/${encodeURIComponent(String(id))}/favorite`);
}

export function createTool(input: ToolMutationInput) {
    return http.post<ToolItem>("/tools", input);
}

export function deleteTool(id: number) {
    return http.delete<{ deleted: boolean }>(`/tools/${encodeURIComponent(String(id))}`);
}
