import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { resilientPreload } from "../build/resilient-preload";
import { warmPreloadResources } from "../src/lib/module-preload";

test("预热合并并发请求，最多四路下载，503 重试后完成正文读取", async () => {
    const original = globalThis.fetch;
    let active = 0;
    let peak = 0;
    const attempts = new Map<string, number>();
    globalThis.fetch = (async (input) => {
        const url = String(input);
        const count = (attempts.get(url) || 0) + 1;
        attempts.set(url, count);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (url.endsWith("/0.js") && count === 1) return new Response("unavailable", { status: 503 });
        return new Response("export default 1", { headers: { "Content-Type": "application/javascript" } });
    }) as typeof fetch;
    try {
        const urls = Array.from({ length: 8 }, (_, i) => `https://assets.example/${i}.js`);
        await Promise.all([warmPreloadResources(urls), warmPreloadResources(urls)]);
        expect(peak).toBeLessThanOrEqual(4);
        expect(attempts.get(urls[0])).toBe(2);
        expect([...attempts.values()].reduce((a, b) => a + b)).toBe(9);
    } finally {
        globalThis.fetch = original;
    }
});

test("404 与 HTML 响应立即失败，失败请求不会永久缓存", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
        calls += 1;
        return calls === 1 ? new Response("missing", { status: 404 }) : new Response("<html/>", { headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
    try {
        const urls = ["https://assets.example/missing.js"];
        await expect(warmPreloadResources(urls)).rejects.toThrow("404");
        await expect(warmPreloadResources(urls)).rejects.toThrow("非脚本或样式");
        expect(calls).toBe(2);
    } finally {
        globalThis.fetch = original;
    }
});

test("真实 Vite helper 的预热失败沿用可取消的恢复事件，不执行原生 import", async () => {
    const vite = readFileSync(resolve(import.meta.dir, "../node_modules/vite/dist/node/chunks/node.js"), "utf8");
    const start = vite.indexOf("function preload(baseModule, deps, importerUrl) {");
    const end = vite.indexOf("\nfunction getPreloadCode", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const transform = resilientPreload().transform as Function;
    const transformed = transform(vite.slice(start, end), "\0vite/preload-helper.js").code.replace('import { warmPreloadResources } from "@/lib/module-preload";', "").replaceAll("import.meta", "importMeta");
    const events: Event[] = [];
    const failure = new Error("asset 404");
    let cancel = true;
    let imported = false;
    const preload = runInNewContext(`${transformed}; preload`, {
        Event,
        URL,
        importMeta: { url: "https://assets.example/entry.js" },
        assetsURL: (dep: string) => dep,
        warmPreloadResources: async () => {
            throw failure;
        },
        window: {
            dispatchEvent: (event: Event) => {
                events.push(event);
                if (cancel) event.preventDefault();
            },
        },
    });
    const nativeImport = async () => {
        imported = true;
    };
    await preload(nativeImport, ["./missing.js"]);
    expect(events[0].type).toBe("vite:preloadError");
    expect((events[0] as Event & { payload: unknown }).payload).toBe(failure);
    expect(imported).toBe(false);
    cancel = false;
    await expect(preload(nativeImport, ["./missing.js"])).rejects.toThrow("asset 404");
    expect(imported).toBe(false);
});
