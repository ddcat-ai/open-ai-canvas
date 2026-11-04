import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import type { AuthLoginMode, AuthSettings } from "@/services/api/auth";

/** 登录、注册、找回密码三个视图；独立页面与弹窗共用同一组视图。 */
export type AuthView = "login" | "register" | "recovery";

const AUTH_VIEW_PATHS: Record<AuthView, string> = {
    login: "/login",
    register: "/register",
    recovery: "/forgot-password",
};

const REFERRAL_CODE_STORAGE_KEY = "yingce:referral-code";

export function authViewFromPath(pathname: string): AuthView | null {
    const entry = (Object.entries(AUTH_VIEW_PATHS) as Array<[AuthView, string]>).find(([, path]) => path === pathname);
    return entry ? entry[0] : null;
}

/** 只接受站内路径，防止 next 被用作开放重定向。 */
export function safeAuthNext(value: string | null | undefined) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}

/** 独立页面地址；回到首页时省略 next，保持地址简洁。 */
export function authPageURL(view: AuthView, next?: string | null) {
    const target = safeAuthNext(next);
    return target === "/" ? AUTH_VIEW_PATHS[view] : `${AUTH_VIEW_PATHS[view]}?next=${encodeURIComponent(target)}`;
}

/** 后台未配置或旧服务端未返回时按弹窗处理，与服务端默认值一致。 */
export function resolveLoginMode(settings: Pick<AuthSettings, "loginMode"> | null | undefined): AuthLoginMode {
    return settings?.loginMode === "page" ? "page" : "modal";
}

/** 不需要登录也能打开的页面：弹窗可以直接叠在这些页面上。 */
export function isPublicAuthLanding(pathname: string) {
    return isGuestWorkspacePath(pathname) || pathname.startsWith("/share/");
}

/**
 * 弹窗模式下访问 /login 等直达地址时，弹窗叠在哪个页面上：
 * next 本身允许游客访问就直接打开 next，否则先回首页，登录成功后再进入 next。
 */
export function authDialogLanding(next: string) {
    const target = safeAuthNext(next);
    const pathname = target.split(/[?#]/)[0] || "/";
    return isPublicAuthLanding(pathname) ? target : "/";
}

/** 推广码只存会话级缓存：用户从推广链接进入后切换登录与注册仍能归属，关闭浏览器后失效。 */
export function rememberReferralCode(value: string | null | undefined) {
    const code = (value || "").trim();
    if (code) window.sessionStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
}

export function readReferralCode() {
    return window.sessionStorage.getItem(REFERRAL_CODE_STORAGE_KEY) || "";
}

export function clearReferralCode() {
    window.sessionStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
}
