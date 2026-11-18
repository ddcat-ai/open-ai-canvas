import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { RequireSkillAdmin } from "@/components/auth/require-skill-admin";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { apiClient } from "@/services/api/request";
import {
    addSkill,
    createSkill,
    createSkillLibraryCategory,
    deleteSkill,
    getSkill,
    installGitHubSkill,
    installSkillRecommendations,
    installSkillUpload,
    invalidateAddedSkillsCache,
    likeSkill,
    listAddedSkills,
    listSkillPresets,
    listSkills,
    removeSkill,
    saveSkillFiles,
    setSkillAgentMode,
    skillFileRawURL,
    syncSkill,
    updateSkill,
    type SkillMutationInput,
} from "@/services/api/skills";
import { getSkillCuration, updateSkillCuration } from "@/services/api/skill-curation";
import { hasSkillAdministrationAccess, hasSkillLibraryAccess } from "@/lib/skill-access";
import { ensureDefaultCanvasAgentSkill } from "@/services/skill-defaults";
import { skillRuntime } from "@/services/skill-runtime";
import { getEcommerceSkillPrompt, emptyEcommerceDraft, normalizeEcommerceReferenceGroups } from "@/services/api/ecommerce";
import { createAgentRun, sendAgentMessage } from "@/services/api/agent";
import { createDrama } from "@/services/api/drama";

const dom = new Window({ url: "https://skills.example.com/skills" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const admin: LocalUser = { id: "skills-access-user", username: "admin", displayName: "Admin", role: "admin", status: "active" };
const ordinary: LocalUser = { ...admin, role: "user" };
const envelope = (data: unknown) => ({ data: { code: 0, data, msg: "ok" }, status: 200, headers: {} });

beforeEach(() => {
    useUserStore.setState({ hydrated: true, user: admin });
    invalidateAddedSkillsCache();
});
afterEach(() => {
    useUserStore.setState({ hydrated: false, user: null });
    invalidateAddedSkillsCache();
});

describe("skill usage and administration access", () => {
    test("active ordinary users can use skills while only administrators can manage them", () => {
        for (const [user, use, manage] of [
            [admin, true, true],
            [ordinary, true, false],
            [{ ...admin, status: "disabled" }, false, false],
            [null, false, false],
        ] as const) {
            useUserStore.setState({ user });
            expect(hasSkillLibraryAccess()).toBe(use);
            expect(hasSkillAdministrationAccess()).toBe(manage);
        }
        useUserStore.setState({ hydrated: false, user: admin });
        expect(hasSkillLibraryAccess()).toBe(false);
        expect(hasSkillAdministrationAccess()).toBe(false);
    });

    for (const path of ["/skills/private/edit"]) {
        test(`${path} does not mount a privileged page before admin authorization`, async () => {
            let mounts = 0;
            const PrivilegedPage = () => {
                mounts += 1;
                return createElement("div", null, "PRIVATE SKILL");
            };
            const host = document.createElement("div");
            document.body.append(host);
            const root = createRoot(host);
            try {
                useUserStore.setState({ hydrated: false, user: admin });
                await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(RequireSkillAdmin, { children: createElement(PrivilegedPage) }))));
                expect(host.textContent).not.toContain("PRIVATE SKILL");
                expect(mounts).toBe(0);
                await act(async () => useUserStore.setState({ hydrated: true, user: ordinary }));
                expect(host.textContent).toContain("只有管理员可以上传和管理技能");
                expect(mounts).toBe(0);
                await act(async () => useUserStore.setState({ user: admin }));
                expect(host.textContent).toContain("PRIVATE SKILL");
                expect(mounts).toBe(1);
                await act(async () => useUserStore.setState({ user: ordinary }));
                expect(host.textContent).not.toContain("PRIVATE SKILL");
            } finally {
                await act(async () => root.unmount());
                host.remove();
            }
        });
    }

    test("anonymous, disabled and unresolved sessions make no skill requests or default installs", async () => {
        const request = spyOn(apiClient, "request").mockImplementation(async () => {
            throw new Error("unexpected skill HTTP request");
        });
        try {
            for (const [state, status] of [
                [{ hydrated: false, user: admin }, 401],
                [{ hydrated: true, user: { ...ordinary, status: "disabled" } }, 403],
                [{ hydrated: true, user: null }, 401],
            ] as const) {
                useUserStore.setState(state);
                await expect(listAddedSkills()).resolves.toEqual({ skills: [] });
                await expect(listSkillPresets()).resolves.toEqual({ presets: [] });
                await expect(ensureDefaultCanvasAgentSkill()).resolves.toEqual({ skills: [] });
                await expect(getSkill("private")).rejects.toMatchObject({ status });
                await expect(getSkillCuration()).rejects.toMatchObject({ status });
                await expect(installGitHubSkill({ url: "https://github.com/example/skill" })).rejects.toMatchObject({ status: 403 });
            }
            expect(request).not.toHaveBeenCalled();
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary users can browse, join, favorite and configure skills without management permission", async () => {
        useUserStore.setState({ user: ordinary });
        const calls: string[] = [];
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            calls.push(`${config.method} ${config.url}`);
            return envelope({ skills: [], presets: [], categories: [] });
        }) as typeof apiClient.request);
        try {
            await listSkills();
            await listAddedSkills();
            await listSkillPresets();
            await getSkill("public");
            await getSkillCuration();
            await addSkill("public");
            await removeSkill("public");
            await likeSkill("public");
            await setSkillAgentMode("public", "manual");
            await installSkillRecommendations("drama");
            await createSkillLibraryCategory({ name: "我的分类" });
            expect(calls).toEqual([
                "get /skills?",
                "get /skills/added",
                "get /skills/presets",
                "get /skills/public",
                "get /skills/curation",
                "post /skills/public/add",
                "delete /skills/public/add",
                "post /skills/public/like",
                "patch /skills/public/agent-mode",
                "post /skills/recommendations/drama/install",
                "post /skills/library-categories",
            ]);
            expect(skillFileRawURL("public", "SKILL.md")).toBe("/api/skills/public/file/raw?path=SKILL.md");
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary owners cannot create, upload, edit, sync, delete or manage platform categories", async () => {
        useUserStore.setState({ user: ordinary });
        const request = spyOn(apiClient, "request").mockImplementation(async () => {
            throw new Error("management request must be rejected before HTTP");
        });
        const input: SkillMutationInput = { skillName: "技能", description: "说明", instruction: "# 技能", tag: "drama", isPrivate: false, markdownUrl: "", showcaseMedia: [], extraInfo: "" };
        try {
            for (const operation of [
                () => createSkill(input),
                () => installSkillUpload({ file: new File(["# 技能"], "SKILL.md") }),
                () => installGitHubSkill({ url: "https://github.com/example/skill" }),
                () => updateSkill("old-owned", input),
                () => saveSkillFiles("old-owned", { baseVersionId: "v1", operations: [] }),
                () => syncSkill("old-owned"),
                () => deleteSkill("old-owned"),
                () => createSkillLibraryCategory({ name: "平台分类", scope: "platform" }),
                () => getSkillCuration(true),
                () => updateSkillCuration(0, { enabled: true }),
            ])
                await expect(operation()).rejects.toMatchObject({ status: 403, reason: "admin_required" });
            expect(request).not.toHaveBeenCalled();
        } finally {
            request.mockRestore();
        }
    });

    test("a role change drops cached data and an in-flight admin catalog", async () => {
        let resolveOld!: (value: unknown) => void;
        let reads = 0;
        const request = spyOn(apiClient, "request").mockImplementation((() => {
            reads += 1;
            return reads === 1
                ? new Promise((resolve) => {
                      resolveOld = resolve;
                  })
                : Promise.resolve(envelope({ skills: [{ skillId: "fresh", isAdded: true }] }));
        }) as typeof apiClient.request);
        try {
            const pending = listAddedSkills();
            useUserStore.setState({ user: ordinary });
            resolveOld(envelope({ skills: [{ skillId: "private-admin", isAdded: true }] }));
            expect(await pending).toEqual({ skills: [] });
            expect((await listAddedSkills()).skills.map((skill) => skill.skillId)).toEqual(["fresh"]);
            expect(reads).toBe(2);
            useUserStore.setState({ user: { ...ordinary, status: "disabled" } });
            expect(await listAddedSkills()).toEqual({ skills: [] });
            expect(reads).toBe(2);
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary creation and ecommerce use selected skill content", async () => {
        useUserStore.setState({ user: ordinary });
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            if (config.url === "/ecommerce/skills/prompt") return envelope({ prompt: "策划工作法" });
            if (config.url?.endsWith("/files")) return envelope({ files: [] });
            return envelope({ file: { file: { path: "SKILL.md", sha256: "hash" }, content: "# 创作工作法", binary: false } });
        }) as typeof apiClient.request);
        try {
            const result = await skillRuntime.prepare({
                profile: "creation",
                prompt: "继续我的创作",
                skills: [{ skillId: "old-private", skillName: "Private", versionId: "v1", version: "1", isAdded: true, instruction: "secret instructions" } as never],
                selectedSkillIds: ["old-private"],
            });
            expect(result.prompt).toContain("# 创作工作法");
            expect(result.selectedSkills.map((skill) => skill.skillId)).toEqual(["old-private"]);
            expect(result.metadata.skillIds).toEqual(["old-private"]);
            expect(await getEcommerceSkillPrompt(["old-private"])).toBe("策划工作法");
            expect(normalizeEcommerceReferenceGroups({ ...emptyEcommerceDraft(), skillIds: ["old-private"] }).skillIds).toEqual(["old-private"]);
            expect(request).toHaveBeenCalledTimes(3);
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary Agent admission preserves pinned skills and skill context", async () => {
        let body: unknown;
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            body = config.data;
            return envelope({ run: {} });
        }) as typeof apiClient.request);
        const input = { canvasId: "", prompt: "正常对话", idempotencyKey: "permission-test", pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] };
        try {
            useUserStore.setState({ user: ordinary });
            await createAgentRun(input);
            expect(body).toMatchObject({ pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] });
            await sendAgentMessage("run-1", input);
            expect(body).toMatchObject({ pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] });
            useUserStore.setState({ user: admin });
            await createAgentRun(input);
            expect(body).toMatchObject({ pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] });
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary drama creation preserves selected skill refs", async () => {
        useUserStore.setState({ user: ordinary });
        let body: unknown;
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            body = config.data;
            return envelope({});
        }) as typeof apiClient.request);
        try {
            await createDrama({ name: "普通短剧", chapters: [], settings: { promptSkill: { skillId: "private", path: "SKILL.md" }, bibleSkill: { skillId: "private", path: "SKILL.md" } }, budgetMicrocredits: 0, start: false });
            expect((body as { settings: object }).settings).toEqual({ promptSkill: { skillId: "private", path: "SKILL.md" }, bibleSkill: { skillId: "private", path: "SKILL.md" } });
            expect(request).toHaveBeenCalledTimes(1);
        } finally {
            request.mockRestore();
        }
    });
});
