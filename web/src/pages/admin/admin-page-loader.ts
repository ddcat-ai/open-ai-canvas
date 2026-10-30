import { createElement, lazy, type ComponentType } from "react";

// 后台页面按需拆包，但路由关闭了 startTransition（application.tsx 的 useTransitions={false}），
// 首次进入某页会触发 Suspense，整块内容被替换成加载提示，看起来像白屏一下。
// 这里在进入后台后空闲时预取全部页面代码；已加载的页面直接同步渲染，不再经过 Suspense。

const preloaders: Array<() => Promise<unknown>> = [];

// 后台路由页面都不接收 props。
type AdminPageModule = { default: ComponentType };

export function lazyAdminPage(factory: () => Promise<AdminPageModule>) {
    let loaded: ComponentType | undefined;
    let pending: Promise<AdminPageModule> | undefined;
    const load = () => {
        pending ??= factory().then(
            (module) => {
                loaded = module.default;
                return module;
            },
            (error: unknown) => {
                // 网络失败时允许下次重新拉取，不把失败结果永久缓存。
                pending = undefined;
                throw error;
            },
        );
        return pending;
    };
    const LazyPage = lazy(load);
    function AdminPageEntry() {
        return createElement(loaded ?? LazyPage);
    }
    preloaders.push(load);
    return AdminPageEntry;
}

let preloadStarted = false;

/** 逐个在浏览器空闲时预取，避免一次并发几十个请求拖慢当前页面。失败的页面在真正打开时再按需加载。 */
export function preloadAdminPages() {
    if (preloadStarted || typeof window === "undefined") return;
    preloadStarted = true;
    const queue = [...preloaders];
    const idle = (callback: () => void) => {
        if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout: 2000 });
        else globalThis.setTimeout(callback, 50);
    };
    const next = () => {
        const load = queue.shift();
        if (!load) return;
        void load()
            .catch(() => undefined)
            .finally(() => idle(next));
    };
    idle(next);
}
