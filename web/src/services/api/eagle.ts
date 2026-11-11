import { http, apiBaseURL } from "@/services/api/request";

export type EagleFolder = {
    id: string;
    name: string;
    parentId?: string;
};

export type EagleLibrary = {
    applicationVersion: string;
    libraryName: string;
    folders: EagleFolder[];
};

export type EagleItem = {
    id: string;
    name: string;
    size: number;
    extension: string;
    tags: string[];
    folderIds: string[];
    url: string;
    annotation: string;
    modificationTime: number;
    width?: number;
    height?: number;
    deleted: boolean;
};

export type EagleAddItemInput = {
    url: string;
    name: string;
    folderId?: string;
    tags?: string[];
    annotation?: string;
    website?: string;
    modificationTime?: number;
};

export async function getEagleLibrary(baseUrl: string, signal?: AbortSignal) {
    return http.get<{ library: EagleLibrary }>("/plugins/eagle/library", { params: { baseUrl }, signal });
}

export async function listEagleItems(input: { baseUrl: string; folderId?: string; keyword?: string; limit?: number; offset?: number; signal?: AbortSignal }) {
    return http.get<{ items: EagleItem[] }>("/plugins/eagle/items", {
        signal: input.signal,
        params: {
            baseUrl: input.baseUrl,
            folderId: input.folderId || undefined,
            keyword: input.keyword || undefined,
            limit: input.limit,
            offset: input.offset,
        },
    });
}

export function eagleItemThumbnailUrl(itemId: string, baseUrl: string) {
    return `${String(apiBaseURL).replace(/\/+$/, "")}/plugins/eagle/items/${encodeURIComponent(itemId)}/thumbnail?baseUrl=${encodeURIComponent(baseUrl)}`;
}

export function eagleItemFileUrl(itemId: string, baseUrl: string) {
    return String(apiBaseURL).replace(/\/+$/, "") + "/plugins/eagle/items/" + encodeURIComponent(itemId) + "/file?baseUrl=" + encodeURIComponent(baseUrl);
}

export async function downloadEagleItem(itemId: string, baseUrl: string, signal?: AbortSignal) {
    const response = await fetch(`${String(apiBaseURL).replace(/\/+$/, "")}/plugins/eagle/items/${encodeURIComponent(itemId)}/file?baseUrl=${encodeURIComponent(baseUrl)}`, { credentials: "include", signal });
    if (!response.ok) {
        let message = "读取 Eagle 素材失败";
        try {
            const body = (await response.json()) as { msg?: string };
            message = body.msg || message;
        } catch {
            // 保留通用错误，避免把 HTML 或服务器内部信息展示给用户。
        }
        throw new Error(message);
    }
    return response.blob();
}

export async function addEagleItem(baseUrl: string, input: EagleAddItemInput, signal?: AbortSignal) {
    return http.post<{ item: { id?: string } }>(`/plugins/eagle/items?baseUrl=${encodeURIComponent(baseUrl)}`, input, { signal });
}

export async function createEagleFolder(baseUrl: string, input: { name: string; parentId?: string }) {
    return http.post<{ created: boolean }>(`/plugins/eagle/folders?baseUrl=${encodeURIComponent(baseUrl)}`, input);
}
