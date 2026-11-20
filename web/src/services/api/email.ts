import { compactApiParams, http } from "./request";

export type EmailLogPurpose = "registration" | "password_reset" | "verification" | "profile_email" | "email_changed" | "test" | "consumption_report";
export type EmailLogStatus = "sent" | "failed" | "skipped";

export type EmailLog = {
    id: string;
    userId: string;
    purpose: EmailLogPurpose;
    recipient: string;
    subject: string;
    status: EmailLogStatus;
    stage: string;
    reason: string;
    smtpHost: string;
    durationMs: number;
    createdAt: string;
};

export type EmailLogParams = {
    keyword?: string;
    purpose?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
};

export type EmailLogPage = { logs: EmailLog[]; total: number; page: number; pageSize: number; last24h: Partial<Record<EmailLogStatus, number>> };

export function listAdminEmailLogs(params: EmailLogParams, signal?: AbortSignal) {
    return http.get<EmailLogPage>("/admin/email-logs", { params: compactApiParams(params), signal });
}

export function sendAdminTestEmail(recipient: string) {
    return http.post<{ sent: boolean }>("/admin/settings/email/test", { recipient });
}

export type NotificationSettings = { consumptionReportEnabled: boolean; emailAvailable: boolean; email: string };

export function getNotificationSettings(signal?: AbortSignal) {
    return http.get<{ settings: NotificationSettings }>("/auth/notification-settings", { signal });
}

export function updateNotificationSettings(input: { consumptionReportEnabled: boolean }) {
    return http.put<{ settings: NotificationSettings }>("/auth/notification-settings", input);
}
