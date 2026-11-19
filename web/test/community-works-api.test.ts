import { afterAll, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import {
    copyCommunityWork,
    getAdminWorks,
    getCommunityWorkReaction,
    getMyWorks,
    getPublicWork,
    getPublicWorks,
    getWorkProject,
    reviewWork,
    setCommunityWorkLiked,
    submitWork,
    updateWork,
    withdrawWork,
    workCategories,
    type CommunityWorkInput,
} from "../src/services/api/community-works";
import { communityWorkMessages } from "../src/i18n/community-work-messages";
import { SUPPORTED_LOCALES } from "../src/i18n/locales";
import { communityWorkSharePath, workResourceOptions, workReturnTarget } from "../src/lib/community-works";
import type { Asset } from "../src/stores/use-asset-store";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";

const original = apiClient.defaults.adapter;
afterAll(() => {
    apiClient.defaults.adapter = original;
});
const input: CommunityWorkInput = { title: "My film", description: "", category: "creative", tags: [], mediaResourceId: "a".repeat(32), coverResourceId: "b".repeat(32), rightsConfirmed: true };

test("submissions, reviews and copies use real scoped endpoints with unwrapped responses", async () => {
    const calls: { method: string | undefined; path: string; payload: unknown; params: unknown }[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push({ method: config.method, path: config.url!, payload: config.data ? JSON.parse(config.data) : undefined, params: config.params });
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: config.url?.endsWith("/copy") ? { project: { id: "copied" } } : { id: "work-test", items: [] } } };
    };
    expect((await submitWork(input)).id).toBe("work-test");
    await updateWork("work/test", input);
    await withdrawWork("work-test");
    await getMyWorks({ page: 3, pageSize: 24, status: "rejected" });
    await getPublicWorks();
    await getPublicWork("work-test");
    await getWorkProject("work-test");
    await getWorkProject("work-test", true);
    await getAdminWorks({ status: "pending", page: 2, pageSize: 24 });
    await reviewWork("work-test", "reject", "Wrong cover");
    expect((await copyCommunityWork("work-test")).project.id).toBe("copied");
    await getCommunityWorkReaction("work-test", false);
    await getCommunityWorkReaction("work-test", true);
    await setCommunityWorkLiked("work-test", true);
    await setCommunityWorkLiked("work-test", false);
    expect(calls.map((call) => call.path)).toEqual([
        "/works",
        "/works/work%2Ftest",
        "/works/work-test/withdraw",
        "/works",
        "/public/works",
        "/public/works/work-test",
        "/public/works/work-test/project",
        "/works/work-test/project",
        "/admin/works",
        "/admin/works/work-test/review",
        "/public/works/work-test/copy",
        "/public/works/work-test/reaction",
        "/works/work-test/reaction",
        "/works/work-test/like",
        "/works/work-test/like",
    ]);
    expect(calls[0].payload).toEqual(input);
    expect(calls[4].params).toEqual({ featured: true });
    expect(calls[3].params).toEqual({ status: "rejected", page: 3, pageSize: 24 });
    expect(calls[8].params).toEqual({ status: "pending", page: 2, pageSize: 24 });
    expect(calls[9].payload).toEqual({ action: "reject", reason: "Wrong cover" });
    expect(calls.slice(-4).map((call) => call.method)).toEqual(["get", "get", "put", "delete"]);
});

test("business failures never report successful publication or copying", async () => {
    apiClient.defaults.adapter = async (config) => ({ status: 200, statusText: "OK", headers: {}, config, data: { code: 400, msg: "Publishing denied" } });
    await expect(submitWork(input)).rejects.toThrow("Publishing denied");
    await expect(copyCommunityWork("work-test")).rejects.toThrow("Publishing denied");
    await expect(reviewWork("work-test", "approve")).rejects.toThrow("Publishing denied");
});

test("all supported locales cover statuses, publishing consent and categories", () => {
    expect(Object.keys(communityWorkMessages).sort()).toEqual(SUPPORTED_LOCALES.map(({ code }) => code).sort());
    for (const messages of Object.values(communityWorkMessages)) {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(communityWorkMessages["zh-CN"]).sort());
        expect(Object.keys(messages.categories)).toEqual([...workCategories]);
        expect(Object.keys(messages.status)).toEqual(["pending", "published", "rejected", "withdrawn", "unlisted"]);
        expect(messages.rights.trim().length).toBeGreaterThan(15);
        expect(messages.projectConsent.trim().length).toBeGreaterThan(15);
    }
});

test("only stored owned media references are selectable; no external or local-only URLs", () => {
    const stored = "a".repeat(32);
    const projectStored = "b".repeat(32);
    const assets = [
        { id: "one", kind: "image", title: "Uploaded", data: { storageKey: `resource:${stored}` } },
        { id: "two", kind: "video", title: "External", data: { url: "https://example.com/file.mp4" } },
        { id: "three", kind: "image", title: "Local", data: { storageKey: "local:file" } },
    ] as Asset[];
    const project = { nodes: [{ type: "video", title: "Result", metadata: { storageKey: `resource:${projectStored}` } }] } as CanvasProject;
    expect(workResourceOptions(assets, project).map((option) => option.id)).toEqual([stored, projectStored]);
    expect(workReturnTarget({ returnTo: "//example.com" }).to).toBe("/");
    expect(workReturnTarget({ returnTo: "/canvas/a", returnState: { a: 1 } })).toEqual({ to: "/canvas/a", state: { a: 1 } });
});

test("shared work links point to the public work route and encode the identifier", () => {
    expect(communityWorkSharePath("work-a")).toBe("/share/work/work-a");
    expect(communityWorkSharePath("work/custom")).toBe("/share/work/work%2Fcustom");
});
