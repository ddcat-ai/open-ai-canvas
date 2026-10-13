import { compactApiParams, http } from "./request";

export type LoginLog = {
    id: string;
    userId: string | null;
    username: string;
    displayName: string;
    account: string;
    event: "login" | "logout";
    method: "password" | "email" | "sms" | "linuxdo" | "verification" | "unknown";
    source: "login" | "registration" | "logout";
    result: "success" | "failed";
    ip: string;
    userAgent: string;
    sessionRef: string;
    reason: string;
    message: string;
    createdAt: string;
};

export type LoginLogParams = {
    keyword?: string;
    event?: string;
    method?: string;
    result?: string;
    ip?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
};

export function listAdminLoginLogs(params: LoginLogParams, signal?: AbortSignal) {
    return http.get<{ logs: LoginLog[]; total: number; page: number; pageSize: number }>("/admin/login-logs", { params: compactApiParams(params), signal });
}

export function getAdminLoginLog(id: string, signal?: AbortSignal) {
    return http.get<{ log: LoginLog }>(`/admin/login-logs/${encodeURIComponent(id)}`, { signal });
}
