import { lazy, Suspense, useEffect, useState } from "react";

import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";

const AuthDialog = lazy(() => import("./auth-dialog"));

/**
 * 全局登录弹窗挂载点，放在 RouterProvider 旁边，分享页等路由外层页面也能打开。
 * 首次打开前不加载表单代码；navigate 由入口传入 router.navigate。
 */
export function AuthDialogHost({ navigate }: { navigate: (to: string) => void }) {
    const open = useAuthDialogStore((state) => state.open);
    const [requested, setRequested] = useState(open);
    useEffect(() => {
        if (open) setRequested(true);
    }, [open]);
    if (!requested) return null;
    return (
        <Suspense fallback={null}>
            <AuthDialog navigate={navigate} />
        </Suspense>
    );
}
