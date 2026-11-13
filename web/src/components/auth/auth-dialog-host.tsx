import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";

const AuthDialog = lazy(() => import("./auth-dialog"));

/**
 * 全局登录弹窗挂载在根路由布局中，登录表单可以使用路由 Hooks。
 * 首次打开前不加载表单代码。
 */
export function AuthDialogHost() {
    const navigate = useNavigate();
    const open = useAuthDialogStore((state) => state.open);
    const [requested, setRequested] = useState(open);
    useEffect(() => {
        if (open) setRequested(true);
    }, [open]);
    if (!requested) return null;
    return (
        <Suspense fallback={null}>
            <AuthDialog navigate={(to) => void navigate(to)} />
        </Suspense>
    );
}
