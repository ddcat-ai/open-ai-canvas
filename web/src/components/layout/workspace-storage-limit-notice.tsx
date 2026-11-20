import { useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import axios from "axios";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";

import { translate } from "@/i18n";
import { accountFileStorageUsageQueryKey } from "@/lib/account-storage-usage";
import { openStoragePurchase, STORAGE_LIMIT_REASONS } from "@/lib/workspace-storage";
import { apiClient } from "@/services/api/request";

const NOTICE_KEY = "workspace-storage-limit";
const NOTICE_INTERVAL_MS = 20_000;

/**
 * 任一业务请求因容量不足或只读被拒时，刷新用量并给出“清理素材 / 购买空间”入口。
 * 只补充提醒，调用方原有的错误处理和提示保持不变。
 */
export function WorkspaceStorageLimitNotice() {
    const { notification } = App.useApp();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const lastNoticeAt = useRef(0);

    useEffect(() => {
        const interceptor = apiClient.interceptors.response.use(undefined, (error: unknown) => {
            const reason = axios.isAxiosError<{ reason?: string }>(error) ? error.response?.data?.reason : undefined;
            if (reason && STORAGE_LIMIT_REASONS.has(reason)) {
                void queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey });
                const now = Date.now();
                if (now - lastNoticeAt.current > NOTICE_INTERVAL_MS) {
                    lastNoticeAt.current = now;
                    const readOnly = reason === "storage_read_only";
                    notification.warning({
                        key: NOTICE_KEY,
                        title: readOnly ? translate("account.layout.storageNotice.readOnlyTitle") : translate("account.layout.storageNotice.fullTitle"),
                        description: readOnly ? translate("account.layout.storageNotice.readOnlyDescription") : translate("account.layout.storageNotice.fullDescription"),
                        actions: (
                            <span style={{ display: "inline-flex", gap: "var(--space-2, 8px)" }}>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        notification.destroy(NOTICE_KEY);
                                        navigate("/assets");
                                    }}
                                >
                                    {translate("account.layout.storageNotice.cleanUp")}
                                </Button>
                                <Button
                                    size="small"
                                    type="primary"
                                    onClick={() => {
                                        notification.destroy(NOTICE_KEY);
                                        openStoragePurchase();
                                    }}
                                >
                                    {translate("account.layout.storageNotice.buy")}
                                </Button>
                            </span>
                        ),
                    });
                }
            }
            return Promise.reject(error);
        });
        return () => apiClient.interceptors.response.eject(interceptor);
    }, [navigate, notification, queryClient]);

    return null;
}
