import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { Skill } from "@/services/api/skills";

const dom = new Window({ url: "https://skills.example.com/skills" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { apiClient } = await import("@/services/api/request");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: SkillsPage } = await import("@/pages/skills");
const { PromptSkillField } = await import("@/pages/projects/prompt-skill");

const skill: Skill = {
    skillId: "legacy-owned",
    skillName: "已有技能",
    description: "可继续使用的工作法",
    instruction: "# 工作法正文",
    versionId: "v1",
    version: "1",
    contentHash: "hash",
    fileCount: 1,
    totalBytes: 30,
    sourceType: "github",
    sourceUrl: "",
    sourceRef: "main",
    sourceSubdir: "",
    sourceCommit: "",
    syncStatus: "synced",
    autoUpdate: false,
    status: 1,
    markdownUrl: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    source: 0,
    tag: "drama",
    sortWeight: 0,
    isPrivate: false,
    likeCount: 0,
    isLike: false,
    ownerUid: "member",
    effectiveUser: { name: "用户", avatarUrl: "", uid: "member" },
    originalSkillId: null,
    showcaseMedia: [],
    addedCount: 1,
    isTest: false,
    extraInfo: "",
    isAdded: true,
    isOwner: true,
};
const file = { path: "SKILL.md", kind: "markdown", mimeType: "text/markdown", size: 30, sha256: "hash" };
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let request: ReturnType<typeof spyOn<typeof apiClient, "request">>;

beforeEach(() => {
    useUserStore.setState({ hydrated: true, user: { id: "member", username: "member", displayName: "Member", role: "user", status: "active" } });
    request = spyOn(apiClient, "request").mockImplementation((async (config) => {
        let data: unknown;
        if (config.url?.startsWith("/skills?")) data = { skills: [skill], totalCount: 1, hasMore: false, nextOffset: 0, page: 1, pageSize: 20, categories: [] };
        else if (config.url === "/skills/curation") data = { enabled: false, revision: 0, categories: [], assignments: [] };
        else if (config.url === "/skills/library-categories") data = { categories: [], totalCount: 1, uncategorizedCount: 1 };
        else if (config.url === "/skills/legacy-owned/files") data = { files: [file] };
        else if (config.url === "/skills/legacy-owned/file") data = { file: { file, content: "# 工作法正文", binary: false } };
        else if (config.url === "/skills/legacy-owned") data = { skill };
        else throw new Error(`Unexpected skill request: ${config.method} ${config.url}`);
        return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    request.mockRestore();
    useUserStore.setState({ hydrated: false, user: null });
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("普通用户能在真实技能页浏览正文，旧技能所有者也没有上传或编辑入口", async () => {
    await act(async () =>
        root.render(
            <MemoryRouter>
                <App>
                    <SkillsPage />
                </App>
            </MemoryRouter>,
        ),
    );
    expect(host.textContent).toContain("已有技能");
    expect(host.textContent).toContain("按行业推荐");
    expect(host.textContent).not.toContain("安装技能");
    expect(host.querySelector(".skill-tile-edit")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="已有技能"]')!.click());
    const detail = document.querySelector(".skill-package-shell")!;
    expect(detail.textContent).toContain("工作法正文");
    expect(detail.querySelector(".skill-package-actions")?.textContent).toContain("收藏");
    expect(detail.querySelector(".skill-package-actions")?.textContent).not.toContain("同步");
    expect(detail.querySelector(".skill-package-actions")?.textContent).not.toContain("技能信息");
    expect(detail.querySelector(".skill-package-actions")?.textContent).not.toContain("作者工作台");
    await act(async () => useUserStore.setState({ user: { ...useUserStore.getState().user!, role: "admin" } }));
    expect(host.textContent).toContain("安装技能");
    expect(host.querySelector(".skill-tile-edit")).not.toBeNull();
    expect(detail.querySelector(".skill-package-actions")?.textContent).toContain("同步");
    expect(detail.querySelector(".skill-package-actions")?.textContent).toContain("技能信息");
});

test("普通用户可更换短剧写作技能，编辑工作台只向管理员展示", async () => {
    const client = new QueryClient();
    await act(async () =>
        root.render(
            <MemoryRouter>
                <QueryClientProvider client={client}>
                    <PromptSkillField value={{ skillId: skill.skillId, skillName: skill.skillName, path: "SKILL.md" }} onChange={() => {}} />
                </QueryClientProvider>
            </MemoryRouter>,
        ),
    );
    expect(host.textContent).toContain("已有技能");
    expect(host.textContent?.replace(/\s/g, "")).toContain("更换");
    expect(host.querySelector(".drama-pskill-edit")).toBeNull();
    await act(async () => useUserStore.setState({ user: { ...useUserStore.getState().user!, role: "admin" } }));
    expect(host.querySelector(".drama-pskill-edit")?.getAttribute("href")).toBe("/skills/legacy-owned/edit");
    client.clear();
});
