import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { detectLocale } from "@/i18n/detect";
import { useLocaleStore, type LocaleName } from "@/stores/use-locale-store";

export const FALLBACK_LOCALE: LocaleName = "zh-CN";

/** namespace 按实测区域切；只有 common 允许被主链高频使用，其余按 (lang, ns) 懒加载 */
export const NAMESPACES = ["common", "auth", "layout", "settings", "error", "project", "canvas", "admin", "tasks", "assets", "plugins", "skills", "wallet", "home", "dev", "domain", "lib"] as const;
export type NamespaceName = (typeof NAMESPACES)[number];

// Vite 构建时 import.meta.glob 被替换为静态映射；用 eager 直接把资源挂进构建产物，
// 避免开发环境下动态 loader 的路径匹配或首帧时序导致 namespace 没有加载。
const localeModules = (import.meta.glob as (pattern: string, options?: { eager?: boolean }) => Record<string, { default: Record<string, unknown> }>)
    ("../locales/*/*.json", { eager: true });

function namespaceFromPath(path: string): string {
    const file = path.split("/").pop() || "";
    return file.replace(/\.json$/, "");
}

async function loadLocaleResources(lng: LocaleName): Promise<void> {
    const localePath = `/locales/${lng}/`;
    await Promise.all(
        Object.entries(localeModules)
            .filter(([path]) => {
                // glob 的键可能是相对路径，也可能被构建器规范化成绝对路径。
                const normalizedPath = path.replaceAll("\\", "/");
                return normalizedPath.includes(localePath) || normalizedPath.includes(`../locales/${lng}/`);
            })
            .map(([path, module]) => {
                const ns = namespaceFromPath(path);
                if (!NAMESPACES.includes(ns as NamespaceName) || i18next.hasResourceBundle(lng, ns)) return;
                i18next.addResourceBundle(lng, ns, module.default, true, true);
            }),
    );
}

/**
 * 切换语言：加载资源 → changeLanguage（react-i18next 自动重渲染）→ 同步 <html lang>。
 * antd / tldraw / vidstack / Excalidraw 各自订阅 useLocaleStore，与这里同源同帧，互不等待。
 */
export async function applyLocale(lng: LocaleName): Promise<void> {
    if (i18next.language === lng) return;
    await loadLocaleResources(lng);
    await i18next.changeLanguage(lng);
    if (typeof document !== "undefined") document.documentElement.lang = lng;
}

let initPromise: Promise<typeof i18next> | null = null;

export function initI18n(): Promise<typeof i18next> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        const stored = useLocaleStore.getState().locale;
        // 首次访问按环境猜一次并立即固化进 store：之后换设备/改系统语言都不再漂移
        const initial = stored ?? detectLocale();
        if (!stored) useLocaleStore.getState().setLocale(initial);
        await i18next.use(initReactI18next).init({
            lng: initial,
            fallbackLng: FALLBACK_LOCALE,
            defaultNS: "common",
            ns: ["common"],
            partialBundledLanguages: true,
            interpolation: { escapeValue: false },
            react: { useSuspense: false },
        });
        await loadLocaleResources(initial);
        if (typeof document !== "undefined") document.documentElement.lang = initial;
        // 语言切换的唯一入口是 store.setLocale；在这里统一订阅，组件不直接调 applyLocale
        useLocaleStore.subscribe((state, prev) => {
            if (state.locale && state.locale !== prev.locale) void applyLocale(state.locale);
        });
        return i18next;
    })();
    return initPromise;
}

/** 非 React 上下文（services/lib）用的单例 t；React 组件请用 useTranslation */
/**
 * 非 React 上下文（services/lib）用的单例 t。
 * i18n 未初始化（bun 测试传环境、SSR 首帧）时回落返回 key 字符串，
 * 保证依赖 t 的模块在任何环境都能加载且行为可断言，而不是 undefined。
 */
export const t: typeof i18next.t = ((key: string | string[], options?: unknown) =>
    i18next.isInitialized ? i18next.t(key as never, options as never) : key) as typeof i18next.t;
