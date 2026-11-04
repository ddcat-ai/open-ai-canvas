import { createElement, lazy, type ComponentType } from "react";

// 路由关闭了 startTransition（application.tsx 的 useTransitions={false}），首次渲染 React.lazy 组件时
// 即使模块已经预取，lazy 仍会拿到一个新的 Promise 挂起一次，Suspense 提示随即替换掉整块内容，
// 看起来像白屏一下。这里记住已解析的组件：预取过或打开过的页面直接同步渲染，不再经过 Suspense。

export type PreloadableComponent<P extends object> = ComponentType<P> & { preload: () => Promise<unknown> };

export function preloadableLazy<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>): PreloadableComponent<P> {
    let loaded: ComponentType<P> | undefined;
    let pending: Promise<{ default: ComponentType<P> }> | undefined;
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
    const LazyComponent = lazy(load);
    function PreloadableEntry(props: P) {
        return createElement(loaded ?? LazyComponent, props);
    }
    return Object.assign(PreloadableEntry, { preload: load });
}

/** 浏览器空闲时逐个预取，避免一次并发大量请求拖慢当前页面；失败的页面在真正打开时再按需加载。 */
export function preloadWhenIdle(loaders: Array<() => Promise<unknown>>) {
    if (typeof window === "undefined") return;
    const queue = [...loaders];
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
