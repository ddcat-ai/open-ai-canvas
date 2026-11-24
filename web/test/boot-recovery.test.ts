import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";

describe("index.html boot recovery", () => {
    test("has boot recovery timeout handler in index.html", () => {
        const html = readFileSync(resolve(import.meta.dir, "../index.html"), "utf8");
        expect(html).toContain("boot-recovery");
        expect(html).toContain("MutationObserver");
    });

    test("等待时长、真实失败和已发布新入口分别处理", async () => {
        const html = readFileSync(resolve(import.meta.dir, "../index.html"), "utf8");
        const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((source) => source.includes("bootTimer"))!;
        const dom = new Window({ url: "https://canvas.example/canvas?mode=recent" });
        dom.document.body.innerHTML = html.slice(html.indexOf('<div id="root">'), html.indexOf("<script>", html.indexOf('<div id="root">')));
        const entry = dom.document.createElement("script");
        entry.type = "module";
        entry.src = "/assets/index-old.js";
        dom.document.head.append(entry);
        let timer: (() => void) | undefined;
        let destination = "";
        let entryAsset = "index-old";
        let versionChecks = 0;
        const listeners = new Map<string, (event: { detail: { status?: number } }) => void>();
        try {
            runInNewContext(script, {
                document: dom.document,
                performance,
                URL,
                AbortSignal,
                DOMParser: dom.DOMParser,
                navigator: dom.navigator,
                addEventListener: (name: string, listener: (event: { detail: { status?: number } }) => void) => listeners.set(name, listener),
                removeEventListener: (name: string) => listeners.delete(name),
                fetch: () => {
                    versionChecks += 1;
                    return Promise.resolve(new Response(`<script type="module" src="/assets/${entryAsset}.js"></script>`));
                },
                MutationObserver: dom.MutationObserver,
                setTimeout: (callback: () => void) => {
                    timer = callback;
                    return 1;
                },
                clearTimeout: () => {
                    timer = undefined;
                },
                location: {
                    href: dom.location.href,
                    replace: (url: string) => {
                        destination = url;
                    },
                },
            });
            timer!();
            const notice = dom.document.getElementById("boot-recovery")!;
            expect(notice.getAttribute("role")).toBe("status");
            expect(notice.textContent).toContain("加载较慢，仍在继续");
            const button = notice.querySelector("button")!;
            expect(button.hidden).toBe(true);
            listeners.get("starai:startup-load-failure")!({ detail: { status: 503 } });
            expect(versionChecks).toBe(0);
            expect(button.hidden).toBe(false);
            expect(destination).toBe("");
            entryAsset = "index-new";
            listeners.get("starai:startup-load-failure")!({ detail: { status: 404 } });
            await Bun.sleep(0);
            expect(versionChecks).toBe(1);
            expect(new URL(destination).searchParams.has("__chunk_recovery")).toBe(true);
            destination = "";
            button.click();
            expect(new URL(destination).searchParams.get("mode")).toBe("recent");
            expect(new URL(destination).searchParams.has("__chunk_recovery")).toBe(true);
            dom.document.getElementById("root")!.appendChild(dom.document.createElement("main"));
            await dom.happyDOM.whenAsyncComplete();
            expect(dom.document.getElementById("boot-recovery")).toBeNull();
            expect(timer).toBeUndefined();
            expect(listeners.size).toBe(0);
        } finally {
            await dom.happyDOM.abort();
        }
    });
});
