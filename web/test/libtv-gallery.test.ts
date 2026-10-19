import { describe, expect, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/query-core";

import { createLatestRequestGuard, getNextLibTVGalleryPageParam, hasLibTVTemplateMarker, libTVGalleryInfiniteQuery, resolveLibTVMakeSame, shuffleLibTVGalleryPages } from "../src/lib/libtv-gallery";
import { buildLibTVGalleryQuery } from "../src/services/api/libtv-gallery";
import type { LibTVGalleryItem, LibTVGalleryParams, LibTVGalleryResponse, LibTVWorkDetailResponse, LibTVWorkStep } from "../src/types/libtv-gallery";

// 字段与 backend/internal/auth/libtv_gallery.go 的 JSON tag 一一对应；媒体均为占位地址，不含真实用户作品。
const REQUEST_ID = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function galleryItem(index: number, overrides: Partial<LibTVGalleryItem> = {}): LibTVGalleryItem {
    return {
        templateUuid: `${String(index).padStart(2, "0")}${"a".repeat(30)}`,
        projectUuid: `${String(index).padStart(2, "0")}${"b".repeat(30)}`,
        title: `公开作品 ${index}`,
        description: "",
        coverUrl: `https://libtv-res.liblib.art/fixture/cover-${index}.png`,
        mediaUrl: `https://libtv-res.liblib.art/fixture/media-${index}.mp4`,
        mediaType: "video",
        authorName: "fixture",
        authorAvatar: "",
        likeCount: 0,
        publishedAt: "2026-09-01T00:00:00Z",
        tags: [{ id: 3, code: "film", label: "影视" }],
        sourceUrl: "https://www.liblib.tv/",
        ...overrides,
    };
}

function galleryPage(page: number, hasMore: boolean, requestId = REQUEST_ID): LibTVGalleryResponse {
    return { items: [galleryItem(page * 10 + 1), galleryItem(page * 10 + 2)], page, pageSize: 20, hasMore, requestId };
}

function step(overrides: Partial<LibTVWorkStep> = {}): LibTVWorkStep {
    return {
        id: "node-1",
        title: "主图",
        type: "image",
        prompt: "雨夜霓虹街道，电影感",
        text: "",
        model: "libtv-model-x",
        mediaUrls: ["https://libtv-res.liblib.art/fixture/step.png"],
        aspectRatio: "16:9",
        resolution: "2K",
        durationSeconds: 0,
        referenceNodeIds: [],
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function observe(client: QueryClient, filters: { keyword: string; tagId?: number }, fetcher: (params: LibTVGalleryParams) => Promise<LibTVGalleryResponse>) {
    const observer = new InfiniteQueryObserver(client, libTVGalleryInfiniteQuery(filters, fetcher));
    const unsubscribe = observer.subscribe(() => {});
    return { observer, unsubscribe };
}

async function settle(observer: InfiniteQueryObserver<LibTVGalleryResponse, Error, unknown, readonly unknown[], unknown>) {
    for (let attempt = 0; attempt < 50 && observer.getCurrentResult().isFetching; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

describe("LibTV gallery contract fixtures", () => {
    test("work detail fixture uses the backend work wrapper and step fields", () => {
        const detail: LibTVWorkDetailResponse = {
            work: galleryItem(1),
            steps: [step(), step({ id: "node-2", type: "video", aspectRatio: "9:16", durationSeconds: 5 })],
            nodeCount: 4,
            connectionCount: 3,
            canImport: true,
            warnings: [{ id: "node-9", message: "节点包含 2 个结果，已导入第 1 个" }],
        };
        expect(detail.work.templateUuid).toHaveLength(32);
        expect(detail.work.tags[0]).toEqual({ id: 3, code: "film", label: "影视" });
        expect(detail.steps.map((item) => resolveLibTVMakeSame(item).ok)).toEqual([true, true]);
    });

    test("builds the gallery query string within backend validation limits", () => {
        const params = new URLSearchParams(buildLibTVGalleryQuery({ page: 2, pageSize: 99, keyword: "  霓虹  ", tagId: 3, requestId: REQUEST_ID }));
        expect(params.get("page")).toBe("2");
        expect(params.get("pageSize")).toBe("40");
        expect(params.get("keyword")).toBe("霓虹");
        expect(params.get("tagId")).toBe("3");
        expect(params.get("requestId")).toBe(REQUEST_ID);

        const first = new URLSearchParams(buildLibTVGalleryQuery({ page: 1, tagId: 0 }));
        expect(first.has("requestId")).toBe(false);
        expect(first.has("tagId")).toBe(false);
        expect(first.has("keyword")).toBe(false);
    });
});

describe("LibTV featured works random ordering", () => {
    test("new visit seeds give different orders without mutating the shared gallery", () => {
        const items = Array.from({ length: 20 }, (_, index) => galleryItem(index + 1));
        const first = shuffleLibTVGalleryPages([{ items }], 123);
        const second = shuffleLibTVGalleryPages([{ items }], 999);
        expect(first).not.toEqual(second);
        expect(items.map((item) => item.title)).toEqual(Array.from({ length: 20 }, (_, index) => `公开作品 ${index + 1}`));
        expect(first).toHaveLength(20);
        expect(new Set(first)).toEqual(new Set(items));
    });

    test("opening a work and appending a page preserve all previously displayed positions", () => {
        const pages = [galleryPage(1, true), galleryPage(2, true)];
        const before = shuffleLibTVGalleryPages(pages, 123);
        expect(shuffleLibTVGalleryPages(pages, 123)).toEqual(before);
        const after = shuffleLibTVGalleryPages([...pages, galleryPage(3, false)], 123);
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after).toHaveLength(6);
    });

    test("overlapping pages do not render duplicate cards or remove earlier positions", () => {
        const first = galleryPage(1, true);
        const second = { ...galleryPage(2, false), items: [first.items[0], galleryItem(21)] };
        const items = shuffleLibTVGalleryPages([first, second], 0);
        expect(items.slice(0, 2)).toEqual(shuffleLibTVGalleryPages([first], 0));
        expect(items).toHaveLength(3);
        expect(new Set(items.map((item) => item.templateUuid)).size).toBe(3);
        expect(shuffleLibTVGalleryPages([], 0)).toEqual([]);
    });
});

describe("LibTV gallery pagination state", () => {
    test("next page reuses the first page requestId and stops when hasMore is false", () => {
        const first = galleryPage(1, true);
        const second = galleryPage(2, true, "ignored-later-id");
        expect(getNextLibTVGalleryPageParam(first, [first])).toEqual({ page: 2, requestId: REQUEST_ID });
        expect(getNextLibTVGalleryPageParam(second, [first, second])).toEqual({ page: 3, requestId: REQUEST_ID });
        expect(getNextLibTVGalleryPageParam(galleryPage(3, false), [first, second, galleryPage(3, false)])).toBeUndefined();
    });

    test("requestId never enters the queryKey", () => {
        const options = libTVGalleryInfiniteQuery({ keyword: " 霓虹 ", tagId: 3 }, async () => galleryPage(1, false));
        expect(options.queryKey).toEqual(["libtv-gallery", "霓虹", 3]);
    });

    test("first page fetches once, then appends pages with the same requestId until the last page", async () => {
        const calls: LibTVGalleryParams[] = [];
        const pages = [galleryPage(1, true), galleryPage(2, true), galleryPage(3, false)];
        const client = createClient();
        const { observer, unsubscribe } = observe(client, { keyword: "" }, async (params) => {
            calls.push(params);
            return pages[params.page - 1];
        });

        await settle(observer);
        // 给首页响应后的任意重新订阅留出时间，确认不会因 requestId 变化循环请求。
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ page: 1, pageSize: 20, requestId: undefined, keyword: undefined, tagId: undefined });

        await observer.fetchNextPage();
        await observer.fetchNextPage();
        const result = observer.getCurrentResult();
        expect(calls.map((call) => [call.page, call.requestId])).toEqual([
            [1, undefined],
            [2, REQUEST_ID],
            [3, REQUEST_ID],
        ]);
        expect(result.data?.pages.flatMap((page) => page.items)).toHaveLength(6);
        expect(result.hasNextPage).toBe(false);
        unsubscribe();
        client.clear();
    });

    test("repeated automatic load signals share the in-flight page instead of refetching it", async () => {
        const calls: number[] = [];
        const nextPage = deferred<LibTVGalleryResponse>();
        const client = createClient();
        const { observer, unsubscribe } = observe(client, { keyword: "" }, async (params) => {
            calls.push(params.page);
            return params.page === 1 ? galleryPage(1, true) : nextPage.promise;
        });
        await settle(observer);
        const first = observer.fetchNextPage({ cancelRefetch: false });
        const repeated = observer.fetchNextPage({ cancelRefetch: false });
        expect(calls).toEqual([1, 2]);
        nextPage.resolve(galleryPage(2, false));
        await Promise.all([first, repeated]);
        expect(observer.getCurrentResult().data?.pages.map((page) => page.page)).toEqual([1, 2]);
        expect(observer.getCurrentResult().hasNextPage).toBe(false);
        unsubscribe();
        client.clear();
    });

    test("search and tag changes start a fresh first page without mixing previous items", async () => {
        const calls: LibTVGalleryParams[] = [];
        const client = createClient();
        const fetcher = async (params: LibTVGalleryParams) => {
            calls.push(params);
            const prefix = params.keyword ? 50 : params.tagId ? 70 : 0;
            return { ...galleryPage(params.page, true, `${prefix}-${REQUEST_ID}`), items: [galleryItem(prefix + params.page)] };
        };
        const all = observe(client, { keyword: "" }, fetcher);
        await settle(all.observer);
        await all.observer.fetchNextPage();
        expect(all.observer.getCurrentResult().data?.pages).toHaveLength(2);
        all.unsubscribe();

        const searched = observe(client, { keyword: "霓虹" }, fetcher);
        await settle(searched.observer);
        const searchedResult = searched.observer.getCurrentResult();
        expect(searchedResult.data?.pages).toHaveLength(1);
        expect(searchedResult.data?.pages[0].items.map((item) => item.title)).toEqual(["公开作品 51"]);
        expect(calls.at(-1)).toMatchObject({ page: 1, keyword: "霓虹", requestId: undefined });
        searched.unsubscribe();

        const tagged = observe(client, { keyword: "", tagId: 3 }, fetcher);
        await settle(tagged.observer);
        expect(calls.at(-1)).toMatchObject({ page: 1, tagId: 3, keyword: undefined, requestId: undefined });
        await tagged.observer.fetchNextPage();
        expect(calls.at(-1)).toMatchObject({ page: 2, tagId: 3, requestId: `70-${REQUEST_ID}` });
        tagged.unsubscribe();
        client.clear();
    });

    test("a failed next page keeps loaded pages and retries the same page with the same requestId", async () => {
        const calls: LibTVGalleryParams[] = [];
        let failSecondPage = true;
        const client = createClient();
        const { observer, unsubscribe } = observe(client, { keyword: "" }, async (params) => {
            calls.push(params);
            if (params.page === 2 && failSecondPage) {
                failSecondPage = false;
                throw new Error("LibTV 暂时不可用");
            }
            return galleryPage(params.page, params.page < 2);
        });
        await settle(observer);
        await observer.fetchNextPage();

        const failed = observer.getCurrentResult();
        expect(failed.isFetchNextPageError).toBe(true);
        expect(failed.data?.pages).toHaveLength(1);
        expect(failed.hasNextPage).toBe(true);

        await observer.fetchNextPage();
        const recovered = observer.getCurrentResult();
        expect(recovered.isFetchNextPageError).toBe(false);
        expect(recovered.data?.pages.map((page) => page.page)).toEqual([1, 2]);
        expect(calls.map((call) => [call.page, call.requestId])).toEqual([
            [1, undefined],
            [2, REQUEST_ID],
            [2, REQUEST_ID],
        ]);
        unsubscribe();
        client.clear();
    });

    test("a slow response for an old search does not leak into the new search", async () => {
        const slowOld = deferred<LibTVGalleryResponse>();
        const client = createClient();
        const fetcher = (params: LibTVGalleryParams) => (params.keyword === "旧" ? slowOld.promise : Promise.resolve({ ...galleryPage(1, false), items: [galleryItem(99)] }));

        const oldSearch = observe(client, { keyword: "旧" }, fetcher);
        oldSearch.unsubscribe();
        const newSearch = observe(client, { keyword: "新" }, fetcher);
        await settle(newSearch.observer);
        slowOld.resolve({ ...galleryPage(1, false), items: [galleryItem(1)] });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(newSearch.observer.getCurrentResult().data?.pages[0].items.map((item) => item.title)).toEqual(["公开作品 99"]);
        newSearch.unsubscribe();
        client.clear();
    });
});

describe("LibTV make-same guard", () => {
    test.each(["{{Mixed 1}}", "{{Image 2}}", "{{ video 3 }}", "{{AUDIO 4}}", "{{Text 10}}"])("detects template marker %s", (marker) => {
        expect(hasLibTVTemplateMarker(`参考 ${marker} 的构图`)).toBe(true);
        expect(resolveLibTVMakeSame(step({ prompt: `参考 ${marker} 的构图` }))).toEqual({ ok: false, reason: "has-references" });
    });

    test("ignores ordinary braces and unknown marker names", () => {
        expect(hasLibTVTemplateMarker("{{Style 1}} 与 {Image 1}")).toBe(false);
        expect(hasLibTVTemplateMarker(undefined)).toBe(false);
    });

    test("blocks steps that reference upstream nodes", () => {
        expect(resolveLibTVMakeSame(step({ referenceNodeIds: ["node-0"] }))).toEqual({ ok: false, reason: "has-references" });
    });

    test("audio and text steps cannot be made independently", () => {
        expect(resolveLibTVMakeSame(step({ type: "audio" }))).toEqual({ ok: false, reason: "unsupported-type" });
        expect(resolveLibTVMakeSame(step({ type: "text", text: "旁白" }))).toEqual({ ok: false, reason: "unsupported-type" });
    });

    test("requires a real prompt", () => {
        expect(resolveLibTVMakeSame(step({ prompt: "   " }))).toEqual({ ok: false, reason: "missing-prompt" });
    });

    test("prefills only mode, prompt and the provided ratio; never the LibTV model or other parameters", () => {
        const image = resolveLibTVMakeSame(step({ prompt: "  雨夜霓虹街道  " }));
        expect(image).toEqual({ ok: true, state: { mode: "image", prompt: "雨夜霓虹街道", ratio: "16:9" } });

        const video = resolveLibTVMakeSame(step({ type: "video", aspectRatio: "", durationSeconds: 8, resolution: "1080p" }));
        expect(video).toEqual({ ok: true, state: { mode: "video", prompt: "雨夜霓虹街道，电影感" } });
        if (video.ok) {
            expect("ratio" in video.state).toBe(false);
            expect(Object.keys(video.state).sort()).toEqual(["mode", "prompt"]);
        }
    });
});

describe("LibTV latest request guard", () => {
    test("only the newest request may write state", () => {
        const guard = createLatestRequestGuard();
        const first = guard.begin();
        const second = guard.begin();
        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(true);
    });

    test("invalidate drops an in-flight request after close, uuid or project switch, or unmount", () => {
        const guard = createLatestRequestGuard();
        const pending = guard.begin();
        guard.invalidate();
        expect(guard.isCurrent(pending)).toBe(false);

        const retry = guard.begin();
        expect(guard.isCurrent(retry)).toBe(true);
    });

    test("simulated dialog flow ignores a stale template response and accepts a manual retry", async () => {
        const guard = createLatestRequestGuard();
        const applied: string[] = [];
        const load = async (label: string, response: Promise<string>) => {
            const token = guard.begin();
            try {
                const value = await response;
                if (guard.isCurrent(token)) applied.push(value);
            } catch {
                if (guard.isCurrent(token)) applied.push(`error:${label}`);
            }
        };
        const oldTemplate = deferred<string>();
        const oldLoad = load("old", oldTemplate.promise);
        guard.invalidate(); // 切换模板或画布
        await load("new", Promise.reject(new Error("timeout")));
        oldTemplate.resolve("old-result");
        await oldLoad;
        await load("retry", Promise.resolve("new-result"));
        expect(applied).toEqual(["error:new", "new-result"]);
    });
});
