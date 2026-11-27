import { http } from "@/services/api/request";

export type NodeToolbarNodeType = "image" | "video" | "audio" | "text";
export type NodeToolbarPreferences = Partial<Record<NodeToolbarNodeType, string[]>>;

export function isNodeToolbarNodeType(value: string | undefined): value is NodeToolbarNodeType {
    return value !== undefined && ["image", "video", "audio", "text"].includes(value);
}

export function getNodeToolbarPreferences(signal?: AbortSignal) {
    return http.get<{ preferences: NodeToolbarPreferences }>("/settings/node-toolbar", { signal });
}

export function saveNodeToolbarPreference(nodeType: NodeToolbarNodeType, pinnedEntryIds: string[]) {
    return http.put<{ pinnedEntryIds: string[] }>(`/settings/node-toolbar/${nodeType}`, { pinnedEntryIds });
}

export function resetNodeToolbarPreference(nodeType: NodeToolbarNodeType) {
    return http.delete<{ nodeType: NodeToolbarNodeType }>(`/settings/node-toolbar/${nodeType}`);
}
