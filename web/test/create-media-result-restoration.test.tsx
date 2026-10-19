import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationMessage } from "../src/pages/create/creation-types";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MediaResult } = await import("../src/pages/create/creation-workspace-messages");
const { apiClient } = await import("../src/services/api/request");
const { clearResourceAccessCache } = await import("../src/services/api/resources");
const originalAdapter = apiClient.defaults.adapter;

afterEach(() => {
    clearResourceAccessCache();
    apiClient.defaults.adapter = originalAdapter;
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function holdResourceAccess() {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    apiClient.defaults.adapter = async (config) => {
        expect(config.url).toBe("/resources/access");
        const requested = JSON.parse(String(config.data)) as Array<{ resourceId: string }>;
        await pending;
        return {
            config,
            status: 200,
            statusText: "OK",
            headers: {},
            data: {
                code: 0,
                data: {
                    items: requested.map(({ resourceId }) => ({
                        resourceId,
                        access: {
                            resourceId,
                            url: `https://media.example/${resourceId}.png`,
                            delivery: "upstream",
                            requestedVariant: "original",
                            actualVariant: "original",
                            issuedAt: new Date().toISOString(),
                            refreshAt: new Date(Date.now() + 60_000).toISOString(),
                            revision: "1",
                        },
                    })),
                },
            },
        };
    };
    return async () => {
        release();
        await new Promise((resolve) => setTimeout(resolve, 35));
    };
}

const result: CreationMessage = {
    id: "restored-result",
    role: "assistant",
    mode: "image",
    content: "商品套图",
    createdAt: "2026-10-17T00:00:00Z",
    status: "done",
    agentRunId: "restored-run",
    batchCompletedCount: 2,
    batchTotal: 2,
};

test("历史图片续签前后保留同一叠图、计数和操作栏，不闪现无结果或单图布局", async () => {
    const release = holdResourceAccess();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MediaResult
                    item={{ ...result, resultUrls: ["https://media.example/expired.png?expires=1", ""], resultStorageKeys: ["resource:restore-first", "resource:restore-second"] }}
                    onCreateVariant={() => {}}
                    onContinueCanvas={() => {}}
                    openingCanvas={false}
                />,
            ),
        );
        const stack = host.querySelector(".creation-image-result-stack");
        const actions = host.querySelector(".creation-media-actions");
        expect(stack).not.toBeNull();
        expect(actions?.textContent).toContain("2 张图片 · 成功 2/2");
        expect(host.textContent).not.toContain("没有返回可预览结果");
        expect(host.querySelector('img[src=""]')).toBeNull();
        expect(host.querySelector('img[src*="expires=1"]')).toBeNull();
        expect(host.querySelector<HTMLButtonElement>(".creation-image-result-stack-front")?.disabled).toBe(true);

        await act(release);
        expect(host.querySelector(".creation-image-result-stack")).toBe(stack);
        expect(host.querySelector(".creation-media-actions")).toBe(actions);
        expect(actions?.textContent).toContain("2 张图片 · 成功 2/2");
        expect(host.querySelector<HTMLImageElement>(".creation-image-result-stack-front .creation-image-square-original")?.src).toBe("https://media.example/restore-first.png");
        expect(host.querySelector<HTMLButtonElement>(".creation-image-result-stack-front")?.disabled).toBe(false);
    } finally {
        await act(async () => root.unmount());
        await release();
        host.remove();
    }
});

test("非方图批次展开为方形卡，部分地址续签仍保留卡片和切图顺序", async () => {
    const release = holdResourceAccess();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MediaResult
                    item={{ ...result, settings: { ratio: "2:3", seconds: "5", quality: "auto", videoQuality: "720p", count: "2" }, resultUrls: ["/images/ready.png", ""], resultStorageKeys: ["resource:partial-first", "resource:partial-second"] }}
                    onCreateVariant={() => {}}
                    onContinueCanvas={() => {}}
                    openingCanvas={false}
                />,
            ),
        );
        expect(host.querySelector(".creation-image-result-stack")).not.toBeNull();
        expect(host.textContent).toContain("2 张图片 · 成功 2/2");
        await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="下一张生成图片"]')!.click());
        expect(host.querySelector(".creation-image-result-stack")?.getAttribute("aria-label")).toBe("第 2 张，共 2 张生成图片");
        expect(host.querySelector<HTMLButtonElement>(".creation-image-result-stack-front")?.disabled).toBe(true);
        await act(async () =>
            Array.from(host.querySelectorAll("button"))
                .find((button) => button.textContent === "展开")!
                .click(),
        );
        const cards = Array.from(host.querySelectorAll(".creation-image-result-grid-expanded .creation-image-result"));
        expect(cards).toHaveLength(2);
        expect((cards[1] as HTMLElement).style.aspectRatio).toBe("1 / 1");
        expect(cards[1].querySelector("img")).toBeNull();

        await act(release);
        expect(Array.from(host.querySelectorAll(".creation-image-result-grid-expanded .creation-image-result"))).toEqual(cards);
        expect(cards[1].querySelector<HTMLImageElement>(".creation-image-square-original")?.src).toBe("https://media.example/partial-second.png");
        expect((cards[1] as HTMLElement).style.aspectRatio).toBe("1 / 1");
        await act(async () =>
            Array.from(host.querySelectorAll("button"))
                .find((button) => button.textContent === "收起")!
                .click(),
        );
        expect(host.querySelector<HTMLImageElement>(".creation-image-result-stack-front .creation-image-square-original")?.src).toBe("https://media.example/partial-second.png");
    } finally {
        await act(async () => root.unmount());
        await release();
        host.remove();
    }
});

test("视频历史同样保留媒体框，签名恢复前不创建空地址播放或下载请求", async () => {
    const release = holdResourceAccess();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<MediaResult item={{ ...result, mode: "video", resultStorageKeys: ["resource:video-restored"] }} onCreateVariant={() => {}} onContinueCanvas={() => {}} openingCanvas={false} />));
        const card = host.querySelector<HTMLButtonElement>(".creation-video-result");
        expect(card).not.toBeNull();
        expect(card?.disabled).toBe(true);
        expect(host.querySelector("video")).toBeNull();
        expect(host.querySelector("a[download]")?.getAttribute("href")).toBeNull();
        await act(release);
        expect(host.querySelector(".creation-video-result")).toBe(card);
        expect(card?.disabled).toBe(false);
        expect(host.querySelector("a[download]")?.getAttribute("href")).toBe("https://media.example/video-restored.png");
    } finally {
        await act(async () => root.unmount());
        await release();
        host.remove();
    }
});

test("单图已有资源身份时保留媒体框，等待签名不重新显示生成中", async () => {
    const release = holdResourceAccess();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(<MediaResult item={{ ...result, status: "pending", batchTotal: 3, batchCompletedCount: 1, resultStorageKeys: ["resource:single-restored"] }} onCreateVariant={() => {}} onContinueCanvas={() => {}} openingCanvas={false} />),
        );
        const card = host.querySelector(".creation-image-result-grid.is-single .creation-image-result");
        expect(card).not.toBeNull();
        expect(host.querySelector(".creation-media-pending")).toBeNull();
        expect(host.textContent).toContain("1 张图片 · 成功 1/3");
        await act(release);
        expect(host.querySelector(".creation-image-result-grid.is-single .creation-image-result")).toBe(card);
    } finally {
        await act(async () => root.unmount());
        await release();
        host.remove();
    }
});
