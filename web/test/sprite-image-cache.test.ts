import { afterEach, expect, test } from "bun:test";
import { createSpriteImageCache } from "../src/services/sprite-image-cache";

const originalFetch = globalThis.fetch;
const caches: ReturnType<typeof createSpriteImageCache>[] = [];
afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const c of caches.splice(0)) c.clear();
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = () => new Response(new Blob(["png"], { type: "image/png" }));
function cache() {
    const c = createSpriteImageCache();
    caches.push(c);
    return c;
}

test("coalesces consumers and reuses thumbnails after the menu closes", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return response();
    }) as typeof fetch;
    const c = cache(),
        a = c.acquire("/thumb", "u", "thumbnail"),
        b = c.acquire("/thumb", "u", "thumbnail");
    expect(await a.promise).toBe(await b.promise);
    a.release();
    b.release();
    const again = c.acquire("/thumb", "u", "thumbnail");
    expect(await again.promise).toBe(await a.promise);
    expect(calls).toBe(1);
    again.release();
});

test("limits thumbnail concurrency and reserves the atlas queue", async () => {
    const pending: ((r: Response) => void)[] = [];
    let calls = 0;
    globalThis.fetch = (() => {
        calls++;
        return new Promise<Response>((r) => pending.push(r));
    }) as typeof fetch;
    const c = cache(),
        thumbs = Array.from({ length: 6 }, (_, i) => c.acquire(`/t${i}`, "u", "thumbnail"));
    expect(calls).toBe(3);
    const atlas = c.acquire("/atlas", "u", "atlas");
    expect(calls).toBe(4);
    pending.splice(0).forEach((r) => r(response()));
    await tick();
    expect(calls).toBe(7);
    pending.splice(0).forEach((r) => r(response()));
    await Promise.all([...thumbs, atlas].map((e) => e.promise));
    [...thumbs, atlas].forEach((e) => e.release());
});

test("isolates accounts and retries failed requests", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return calls === 1 ? new Response("denied", { status: 403 }) : response();
    }) as typeof fetch;
    const c = cache(),
        failed = c.acquire("/draft", "a", "thumbnail");
    await expect(failed.promise).rejects.toThrow();
    failed.release();
    const a = c.acquire("/draft", "a", "thumbnail"),
        b = c.acquire("/draft", "b", "thumbnail");
    expect(await a.promise).not.toBe(await b.promise);
    expect(calls).toBe(3);
    a.release();
    b.release();
});

test("evicts unused atlases under the decoded memory budget", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return response();
    }) as typeof fetch;
    const c = cache();
    for (let i = 0; i < 4; i++) {
        const e = c.acquire(`/a${i}`, "u", "atlas", 20 * 1024 * 1024);
        await e.promise;
        e.release();
        await tick();
    }
    const old = c.acquire("/a0", "u", "atlas", 20 * 1024 * 1024);
    await old.promise;
    expect(calls).toBe(5);
    old.release();
});

test("cancels unused requests without caching an aborted image", async () => {
    globalThis.fetch = ((_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const c = cache(),
        e = c.acquire("/slow", "u", "thumbnail");
    e.release();
    await expect(e.promise).rejects.toThrow("aborted");
});
