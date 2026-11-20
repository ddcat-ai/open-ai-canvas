import type { ComponentType } from "react";
import { preloadableLazy, preloadWhenIdle } from "@/lib/preloadable-lazy";

// 后台页面按需拆包；进入后台后空闲时预取全部页面代码，已加载的页面直接同步渲染，不再经过 Suspense。

const preloaders: Array<() => Promise<unknown>> = [];

// 后台路由页面都不接收 props。
type AdminPageModule = { default: ComponentType };

export function lazyAdminPage(factory: () => Promise<AdminPageModule>) {
    const page = preloadableLazy(factory);
    preloaders.push(page.preload);
    return page;
}

let preloadStarted = false;

export function preloadAdminPages() {
    if (preloadStarted) return;
    preloadStarted = true;
    preloadWhenIdle(preloaders);
}
