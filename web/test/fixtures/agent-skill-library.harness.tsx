import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { Skill } from "@/services/api/skills";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasAgentSkillLibraryModal } = await import("@/components/canvas/canvas-agent-skill-library-modal");
const { classifyAgentSkillSelection } = await import("@/lib/canvas/agent-skill-selection");
const { canvasThemes } = await import("@/lib/canvas-theme");
afterAll(() => dom.happyDOM.abort());

async function fixture() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const skills = Array.from({ length: 9 }, (_, i) => ({ skillId: `valid-${i}`, skillName: `正常技能 ${i}`, isAdded: true, status: 1, libraryCategoryId: "writing" }) as Skill);
    const removed: string[] = [];
    let props: ComponentProps<typeof CanvasAgentSkillLibraryModal> = {
        curationState: { curation: null, error: "", retry: () => {} },
        platformCategory: "",
        onPlatformCategoryChange: () => {},
        open: true,
        theme: canvasThemes.light,
        installedSkills: skills,
        marketSkills: skills,
        selectedSkillIds: ["valid-0", "deleted"],
        selection: classifyAgentSkillSelection(["valid-0", "deleted"], skills),
        catalogStatus: "ready",
        onRetryCatalog: () => {},
        categories: [],
        libraryCategories: [{ id: "writing", name: "写作分类", scope: "personal", count: 9 }],
        category: "all",
        search: "",
        loading: false,
        hasMore: false,
        onClose: () => {},
        onCategoryChange: () => {},
        onSearch: () => {},
        onToggle: (id) => removed.push(id),
        onInstall: async () => {},
        onLoadMore: async () => {},
    };
    const render = async (patch: Partial<typeof props> = {}) => {
        props = { ...props, ...patch };
        await act(async () => {
            root.render(<CanvasAgentSkillLibraryModal {...props} />);
        });
    };
    const click = async (text: string) => {
        const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
        expect(button, text).toBeDefined();
        await act(async () => {
            button!.click();
        });
    };
    await render();
    return {
        skills,
        removed,
        render,
        click,
        close: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("#888 enabled count and footer stay stable when search and category hide cards; stale references remain removable", async () => {
    const f = await fixture();
    try {
        await f.click("已启用");
        expect(document.querySelector(".canvas-agent-skill-library-count")?.textContent).toContain("已启用 1 / 8");
        expect(document.querySelector(".canvas-agent-skill-library-count")?.textContent).toContain("已失效 1");
        expect(document.querySelector(".canvas-agent-skill-library-footer")?.textContent).toContain("1 个技能将在本轮生效");
        await f.render({ search: "不匹配的搜索" });
        expect(document.querySelectorAll(".canvas-agent-skill-card")).toHaveLength(0);
        expect(document.querySelector(".canvas-agent-skill-library-footer")?.textContent).toContain("1 个技能将在本轮生效");
        await f.click("未分类");
        expect(document.querySelector(".canvas-agent-skill-library-count")?.textContent).toContain("已启用 1 / 8");
        expect(document.querySelector('[aria-label="已失效技能"]')?.textContent).toContain("deleted");
        await f.click("从当前对话移除");
        expect(f.removed).toEqual(["deleted"]);
    } finally {
        await f.close();
    }
});

test("#888 failed or loading catalogs offer no invalid-removal action", async () => {
    const f = await fixture();
    try {
        await f.click("已启用");
        for (const catalogStatus of ["loading", "error"] as const) {
            await f.render({ catalogStatus, selection: classifyAgentSkillSelection(["valid-0", "deleted"], null) });
            expect(document.querySelector('[aria-label="已失效技能"]')).toBeNull();
            expect(document.body.textContent).not.toContain("从当前对话移除");
            expect(document.querySelector(".canvas-agent-skill-library-count")?.textContent).toContain("待确认 2");
        }
        expect(document.body.textContent).toContain("选择已保留");
    } finally {
        await f.close();
    }
});

test("#888 eight valid selections disable the ninth skill but keep existing skills deselectable", async () => {
    const f = await fixture();
    try {
        const ids = f.skills.slice(0, 8).map((item) => item.skillId);
        await f.render({ selectedSkillIds: ids, selection: classifyAgentSkillSelection(ids, f.skills) });
        await f.click("全部技能");
        const cards = [...document.querySelectorAll(".canvas-agent-skill-card")];
        expect(cards).toHaveLength(9);
        expect(cards[8].querySelector("button")?.disabled).toBe(true);
        expect(cards[0].querySelector("button")?.disabled).toBe(false);
    } finally {
        await f.close();
    }
});
