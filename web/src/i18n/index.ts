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
// ⚠️ import.meta.glob 是 Vite 编译期宏，只有「直接调用」才会被替换；
// 因此绝不能经变量间接调用（否则浏览器运行时 import.meta.glob 是 undefined，
// 资源一个都加载不出来，t() 全部退化成返回 key 字面量）。
// bun test / SSR 无 import.meta.glob：只在函数体内直接调用，且仅浏览器分支会执行到它。
type LocaleModuleMap = Record<string, { default: Record<string, unknown> }>;

let localeModules: LocaleModuleMap | null = null;

// 必须是直接调用：Vite 编译期把它替换成静态映射（eager 内联所有 locale JSON）
function loadViteLocaleModules(): LocaleModuleMap {
    return import.meta.glob("../locales/*/*.json", { eager: true });
}

async function resolveLocaleModules(): Promise<LocaleModuleMap> {
    if (localeModules) return localeModules;
    // 浏览器（Vite 运行时）：走编译期宏
    if (typeof window !== "undefined") {
        localeModules = loadViteLocaleModules();
        return localeModules;
    }
    // Node/bun（bun test / SSR）：无 import.meta.glob，直接读磁盘。
    try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const localesDir = path.join(process.cwd(), "src", "locales");
        const out: LocaleModuleMap = {};
        for (const lang of fs.readdirSync(localesDir)) {
            const langDir = path.join(localesDir, lang);
            if (!fs.statSync(langDir).isDirectory()) continue;
            for (const file of fs.readdirSync(langDir)) {
                if (!file.endsWith(".json")) continue;
                out["../locales/" + lang + "/" + file] = { default: JSON.parse(fs.readFileSync(path.join(langDir, file), "utf8")) };
            }
        }
        localeModules = out;
    } catch {
        localeModules = {};
    }
    return localeModules;
}

function namespaceFromPath(path: string): string {
    const file = path.split("/").pop() || "";
    return file.replace(/\.json$/, "");
}

async function loadLocaleResources(lng: LocaleName): Promise<void> {
    const modules = await resolveLocaleModules();
    const localePath = `/locales/${lng}/`;
    await Promise.all(
        Object.entries(modules)
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
        /*
         * ========================================================================
         * 步骤1：恢复持久化语言
         * ========================================================================
         * 目标数据：useLocaleStore 的 localStorage 快照
         * 操作：
         *   1) 等待 Zustand persist 完成恢复
         *   2) 再读取用户上次选择的语言
         * 影响：刷新时不会先按浏览器语言初始化，再把英文界面回落成中文
         */
        console.info("[i18n] 开始恢复持久化语言...");
        // 1.1 等待语言 store 完成 hydration，避免读取到初始 null
        await useLocaleStore.persist.rehydrate();
        console.info("[i18n] 持久化语言恢复完成");

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
