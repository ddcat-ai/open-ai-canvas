import { createElement, lazy, type ComponentType } from "react";
import { PageResourceBoundary } from "@/components/layout/page-resource-error-state";
import { prioritizeModuleLoad, withModuleLoadPriority, type ModuleLoadPriority } from "@/lib/module-preload";

// 路由关闭了 startTransition（application.tsx 的 useTransitions={false}），首次渲染 React.lazy 组件时
// 即使模块已经预取，lazy 仍会拿到一个新的 Promise 挂起一次，Suspense 提示随即替换掉整块内容，
// 看起来像白屏一下。这里记住已解析的组件：预取过或打开过的页面直接同步渲染，不再经过 Suspense。

export type PreloadableComponent<P extends object> = ComponentType<P> & { preload: () => Promise<unknown> };

export function preloadableLazy<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>): PreloadableComponent<P> {
    let loaded: ComponentType<P> | undefined;
    let pending: { priority: ModuleLoadPriority; promise: Promise<{ default: ComponentType<P> }> } | undefined;
    const load = (foreground: boolean) => {
        if (pending) {
            if (foreground) prioritizeModuleLoad(pending.priority);
            return pending.promise;
        }
        const priority = { foreground };
        const promise = withModuleLoadPriority(priority, factory).then(
            (module) => {
                loaded = module.default;
                return module;
            },
            (error: unknown) => {
                if (!priority.foreground) pending = undefined;
                throw error;
            },
        );
        pending = { priority, promise };
        return promise;
    };
    let LazyComponent = lazy(() => load(true));
    const retry = () => {
        // React.lazy retains its rejected promise even after the download is gone.
        pending = undefined;
        LazyComponent = lazy(() => load(true));
    };
    function LoadPage(props: P) {
        return createElement(loaded ?? LazyComponent, props);
    }
    function PreloadableEntry(props: P) {
        return createElement(PageResourceBoundary, { onRetry: retry, children: createElement(LoadPage, props) });
    }
    return Object.assign(PreloadableEntry, { preload: () => load(false) });
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
