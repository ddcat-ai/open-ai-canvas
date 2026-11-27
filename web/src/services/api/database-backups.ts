import { http } from "./request";

export interface DatabaseBackupSettings {
    enabled: boolean;
    dailyTime: string;
    timezone: string;
    retainCount: number;
    recoveryPassword?: string;
    hasStorageSecret: boolean;
    hasRecoveryPassword: boolean;
    storage: {
        provider: "aliyun" | "s3";
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        accessKeySecret?: string;
        pathPrefix: string;
        pathStyle: boolean;
    };
}
export interface DatabaseBackupRecord {
    id: string;
    status: string;
    stage: string;
    trigger: string;
    database: string;
    size: number;
    sha256: string;
    startedAt: string;
    finishedAt?: string;
    error?: string;
    cleanupWarning?: string;
}
export const databaseBackups = {
    settings: () => http.get<{ settings: DatabaseBackupSettings }>("/admin/database-backups/settings"),
    save: (settings: DatabaseBackupSettings) => http.patch<{ settings: DatabaseBackupSettings }>("/admin/database-backups/settings", settings),
    records: () => http.get<{ records: DatabaseBackupRecord[] }>("/admin/database-backups"),
    start: () => http.post<{ record: DatabaseBackupRecord }>("/admin/database-backups"),
    download: (id: string) => http.post<{ url: string }>(`/admin/database-backups/${encodeURIComponent(id)}/download`),
};
