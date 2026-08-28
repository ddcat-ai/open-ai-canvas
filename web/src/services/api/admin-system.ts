import { apiClient, request } from "@/services/api/request";

export type SystemInstance = {
    id: string;
    name: string;
    role: string;
    ip: string;
    status: string;
    online: boolean;
    cpuPercent: number;
    memoryPercent: number;
    memoryUsedGb: number;
    memoryTotalGb: number;
    diskPercent: number;
    diskUsedGb: number;
    diskTotalGb: number;
    version: string;
    platform: string;
    bootedAt: string;
    reportedAt: string;
};

export function getAdminSystemInstances() {
    return request<{ instances: SystemInstance[]; intervalSeconds: number }>(apiClient.get("/admin/system/instances"));
}
