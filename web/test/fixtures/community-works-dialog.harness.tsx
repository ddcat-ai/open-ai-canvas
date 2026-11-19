import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../../src/i18n";
import { apiClient } from "../../src/services/api/request";
import type { CommunityWork } from "../../src/services/api/community-works";

const dom = new Window({ url: "https://canvas.example/my/works", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLFormElement: dom.HTMLFormElement,
    HTMLInputElement: dom.HTMLInputElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    ShadowRoot: dom.ShadowRoot,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { WorkPublishDialog } = await import("../../src/pages/works/work-publish-dialog");
const settle = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
    });
};
after(async () => {
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("real publishing form prompts for permission before sending, then resubmits selected resources", async () => {
    const adapter = apiClient.defaults.adapter;
    const requests: { url: string; method: string; body?: Record<string, unknown> }[] = [];
    const work: CommunityWork = {
        id: "work-existing",
        title: "成片",
        description: "作品描述",
        category: "drama",
        tags: [],
        author: "创作者",
        kind: "video",
        mediaResourceId: "a".repeat(32),
        coverResourceId: "b".repeat(32),
        mediaUrl: "/media.mp4",
        coverUrl: "/cover.png",
        hasProject: false,
        status: "published",
        featured: false,
        createdAt: "",
        updatedAt: "",
    };
    apiClient.defaults.adapter = async (config) => {
        requests.push({ url: config.url!, method: config.method!, body: config.data ? JSON.parse(config.data) : undefined });
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: config.method === "put" ? { ...work, status: "pending" } : config.url === "/assets" ? { assets: [], hasMore: false } : { projects: [] } } };
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved = 0;
    try {
        await i18n.changeLanguage("zh-CN");
        await act(async () => {
            root.render(
                <I18nextProvider i18n={i18n}>
                    <QueryClientProvider client={client}>
                        <ConfigProvider theme={{ token: { motion: false } }}>
                            <App>
                                <WorkPublishDialog
                                    work={work}
                                    onClose={() => {}}
                                    onSaved={() => {
                                        saved++;
                                    }}
                                />
                            </App>
                        </ConfigProvider>
                    </QueryClientProvider>
                </I18nextProvider>,
            );
        });
        const submit = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
        assert.ok(submit);
        assert.equal(submit.disabled, false);
        assert.match(document.body.textContent, /重新投稿后需再次审核/);
        await act(async () => {
            submit.click();
        });
        await settle();
        assert.match(document.body.textContent, /请先勾选发布授权声明/);
        assert.equal(requests.filter((request) => request.method === "put").length, 0);
        await act(async () => {
            document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        });
        await act(async () => {
            submit.click();
        });
        await settle();
        const writes = requests.filter((request) => request.method === "put");
        assert.equal(writes.length, 1);
        assert.equal(writes[0].url, "/works/work-existing");
        assert.equal(writes[0].body?.rightsConfirmed, true);
        assert.equal(writes[0].body?.mediaResourceId, work.mediaResourceId);
        assert.equal(writes[0].body?.coverResourceId, work.coverResourceId);
        assert.equal(saved, 1);
    } finally {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        client.clear();
        apiClient.defaults.adapter = adapter;
    }
});
