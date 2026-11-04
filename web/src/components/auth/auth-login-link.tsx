import type { MouseEvent } from "react";
import { Link, useLocation, type LinkProps } from "react-router";

import { useAuthLoginMode } from "@/hooks/use-auth-entry";
import { authPageURL, type AuthView } from "@/lib/auth-entry";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";

type AuthLoginLinkProps = Omit<LinkProps, "to"> & { view?: AuthView };

/**
 * 游客登录入口。保留真实链接（新标签页打开、复制地址仍指向 /login），
 * 弹窗模式下普通点击改为在当前页面打开登录框，登录后留在原页面。
 */
export function AuthLoginLink({ view = "login", onClick, ...props }: AuthLoginLinkProps) {
    const location = useLocation();
    const mode = useAuthLoginMode();
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || mode !== "modal") return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        useAuthDialogStore.getState().openDialog(view, null);
    };
    return <Link {...props} to={authPageURL(view, location.pathname + location.search)} onClick={handleClick} />;
}
