import { apiClient, request } from "@/services/api/request";

export type ComfyBridgeSummary = {
    id: string;
    name: string;
    enabled: boolean;
    online: boolean;
    lastSeenAt?: string;
    lastTaskAt?: string;
    capabilities?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type ComfyBridgeRegistration = {
    bridge: ComfyBridgeSummary;
    token: string;
};

export function listComfyBridges() {
    return request<ComfyBridgeSummary[]>(apiClient.get("/comfy-bridges"));
}

export function createComfyBridge(name: string, capabilities?: Record<string, unknown>) {
    return request<ComfyBridgeRegistration>(apiClient.post("/comfy-bridges", { name, capabilities }));
}

export function revokeComfyBridge(id: string) {
    // 部分生产代理默认拦截 DELETE；后端保留 DELETE 兼容，但管理端统一走显式撤销动作。
    return request<{ revoked: boolean }>(apiClient.post(`/comfy-bridges/${encodeURIComponent(id)}/revoke`));
}
