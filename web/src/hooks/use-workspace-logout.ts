import { App } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";

import { applyUserSession } from "@/lib/user-session";
import { logout } from "@/services/api/auth";

/**
 * 工作区退出登录：供侧栏底部与顶部账户菜单共用。
 * 写路径强校验：失败必须明确提示，不得静默吞错。
 */
export function useWorkspaceLogout() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await logout();
            await applyUserSession({ user: null, systemChannels: [] });
            message.success("已退出登录");
            navigate("/login", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出失败");
        } finally {
            setLoggingOut(false);
        }
    };

    return { handleLogout, loggingOut };
}
