import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { RequireSkillAdmin } from "@/components/auth/require-skill-admin";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { apiClient } from "@/services/api/request";
import { getSkill, installGitHubSkill, invalidateAddedSkillsCache, listAddedSkills, listSkillPresets } from "@/services/api/skills";
import { getSkillCuration } from "@/services/api/skill-curation";
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

describe("administrator skill library access", () => {
    for (const path of ["/skills", "/skills/private/edit"]) {
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
                expect(host.textContent).toContain("技能库仅供管理员查看和管理");
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

    test("ordinary and unresolved sessions make no skill requests or default installs", async () => {
        const request = spyOn(apiClient, "request").mockImplementation(async () => {
            throw new Error("unexpected skill HTTP request");
        });
        try {
            for (const state of [
                { hydrated: false, user: admin },
                { hydrated: true, user: ordinary },
                { hydrated: true, user: null },
            ]) {
                useUserStore.setState(state);
                await expect(listAddedSkills()).resolves.toEqual({ skills: [] });
                await expect(listSkillPresets()).resolves.toEqual({ presets: [] });
                await expect(ensureDefaultCanvasAgentSkill()).resolves.toEqual({ skills: [] });
                await expect(getSkill("private")).rejects.toMatchObject({ status: 403 });
                await expect(getSkillCuration()).rejects.toMatchObject({ status: 403 });
                await expect(installGitHubSkill({ url: "https://github.com/example/skill" })).rejects.toMatchObject({ status: 403 });
            }
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
            expect(await listAddedSkills()).toEqual({ skills: [] });
            expect(reads).toBe(1);
            useUserStore.setState({ user: admin });
            expect((await listAddedSkills()).skills.map((skill) => skill.skillId)).toEqual(["fresh"]);
            expect(reads).toBe(2);
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary creation continues without reading stale selected skill files", async () => {
        useUserStore.setState({ user: ordinary });
        const request = spyOn(apiClient, "request").mockImplementation(async () => {
            throw new Error("skill endpoint forbidden");
        });
        try {
            const result = await skillRuntime.prepare({
                profile: "creation",
                prompt: "继续我的创作",
                skills: [{ skillId: "old-private", skillName: "Private", isAdded: true, instruction: "secret instructions" } as never],
                selectedSkillIds: ["old-private"],
            });
            expect(result.prompt).toBe("继续我的创作");
            expect(result.selectedSkills).toEqual([]);
            expect(result.metadata).toEqual({});
            expect(await getEcommerceSkillPrompt(["old-private"])).toBe("");
            expect(normalizeEcommerceReferenceGroups({ ...emptyEcommerceDraft(), skillIds: ["old-private"] }).skillIds).toEqual([]);
            expect(request).not.toHaveBeenCalled();
        } finally {
            request.mockRestore();
        }
    });

    test("ordinary Agent admission drops persisted pinned skills and skill context", async () => {
        let body: unknown;
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            body = config.data;
            return envelope({ run: {} });
        }) as typeof apiClient.request);
        const input = { canvasId: "", prompt: "正常对话", idempotencyKey: "permission-test", pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] };
        try {
            useUserStore.setState({ user: ordinary });
            await createAgentRun(input);
            expect(body).toMatchObject({ pinnedSkillIds: [], contextScope: ["canvas"] });
            await sendAgentMessage("run-1", input);
            expect(body).toMatchObject({ pinnedSkillIds: [], contextScope: ["canvas"] });
            useUserStore.setState({ user: admin });
            await createAgentRun(input);
            expect(body).toMatchObject({ pinnedSkillIds: ["private"], contextScope: ["canvas", "skills"] });
        } finally {
            request.mockRestore();
        }
    });

    test("drama creation removes stale skill refs without blocking the ordinary request", async () => {
        useUserStore.setState({ user: ordinary });
        let body: unknown;
        const request = spyOn(apiClient, "request").mockImplementation((async (config) => {
            body = config.data;
            return envelope({});
        }) as typeof apiClient.request);
        try {
            await createDrama({ name: "普通短剧", chapters: [], settings: { promptSkill: { skillId: "private", path: "SKILL.md" }, bibleSkill: { skillId: "private", path: "SKILL.md" } }, budgetMicrocredits: 0, start: false });
            expect((body as { settings: object }).settings).toEqual({});
            expect(request).toHaveBeenCalledTimes(1);
        } finally {
            request.mockRestore();
        }
    });
});
