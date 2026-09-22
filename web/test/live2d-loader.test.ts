import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installLive2DLoader } from "../src/services/live2d-loader";
import type { Live2DLoader, Live2DLoaderContext } from "pixi-live2d-display/cubism4";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("Live2D loader restricts credentialed URLs, propagates failures and aborts on destroy", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://canvas.example/admin" } } });
    const loader = { middlewares: [] } as unknown as typeof Live2DLoader;
    installLive2DLoader(loader);
    installLive2DLoader(loader);
    expect(loader.middlewares).toHaveLength(1);
    const run = (context: Live2DLoaderContext) => loader.middlewares[0](context, async () => {});
    const url = "/api/admin/settings/appearance/live2d/id/model.model3.json";
    let requests = 0;
    globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
        requests++;
        expect(options.credentials).toBe("include");
        return new Response('{"Version":3}', { status: 200 });
    }) as typeof fetch;
    const context = { url, type: "json" } as Live2DLoaderContext;
    await run(context);
    expect(context.result).toEqual({ Version: 3 });
    for (const unsafe of ["https://evil.example" + url, "/api/admin/users", "//evil.example/model.json"]) {
        await expect(run({ url: unsafe, type: "json" })).rejects.toThrow("本站模型接口");
    }
    expect(requests).toBe(1);
    globalThis.fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
    await expect(run({ url, type: "json" })).rejects.toThrow("403");

    const target = new EventEmitter();
    globalThis.fetch = ((_url: unknown, options: RequestInit) =>
        new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch;
    const pending = run({ url, type: "json", target: target as unknown as Live2DLoaderContext["target"] });
    target.emit("destroy");
    await expect(pending).rejects.toThrow("aborted");
    expect(target.listenerCount("destroy")).toBe(0);
});
