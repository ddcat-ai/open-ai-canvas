import { App } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";

import { applyUserSession } from "@/lib/user-session";
import { logout } from "@/services/api/auth";
import { useTranslation } from "react-i18next";

/**
 * 工作区退出登录：供侧栏底部与顶部账户菜单共用。
 * 写路径强校验：失败必须明确提示，不得静默吞错。
 */
export function useWorkspaceLogout() {
    const { t } = useTranslation("canvas");
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await logout();
            await applyUserSession({ user: null, logicalModels: [] });
            message.success(t("domain:signed-out"));
            navigate("/login", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("domain:sign-out-failed"));
        } finally {
            setLoggingOut(false);
        }
    };

    return { handleLogout, loggingOut };
}
