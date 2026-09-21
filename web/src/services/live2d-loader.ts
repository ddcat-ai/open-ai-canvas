import type { Live2DLoader as Loader } from "pixi-live2d-display/cubism4";
import { apiBaseURL } from "@/services/api/request";

const installed = new WeakSet<typeof Loader>();

// The SDK's default XHR loader omits cross-origin cookies and has no deadline.
// Restrict credentialed requests to our own model API, never model-provided hosts.
export function installLive2DLoader(loader: typeof Loader) {
    if (installed.has(loader)) return;
    installed.add(loader);
    loader.middlewares.unshift(async (context) => {
        const base = new URL(`${apiBaseURL.replace(/\/$/, "")}/`, window.location.href);
        const url = new URL(context.settings ? context.settings.resolveURL(context.url) : context.url, window.location.href);
        const allowed = ["public", "admin/settings"].some((prefix) => url.pathname.startsWith(`${base.pathname}${prefix}/appearance/live2d/`));
        if (url.origin !== base.origin || !allowed) throw new Error("Live2D 资源必须来自本站模型接口");
        const controller = new AbortController();
        const abort = () => controller.abort();
        const deadline = setTimeout(abort, 20000);
        context.target?.once("destroy", abort);
        try {
            const response = await fetch(url, { credentials: "include", signal: controller.signal });
            if (!response.ok) throw new Error(`Live2D 资源加载失败（${response.status}）`);
            context.result = context.type === "json" ? await response.json() : await response.arrayBuffer();
        } finally {
            clearTimeout(deadline);
            context.target?.off("destroy", abort);
        }
    });
}
