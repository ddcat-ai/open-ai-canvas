import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import type { CreationAgentPlanItem } from "../src/pages/create/creation-types";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, SVGElement: dom.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationAgentReview } = await import("../src/pages/create/creation-agent-review");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const items: CreationAgentPlanItem[] = [
    { id: "plan", title: "规划套图", status: "done" },
    { id: "image-1", title: "生成场景图", status: "doing", targetCopy: "Daily use", zhReviewCopy: "日常使用", specs: { size: "1:1" } },
    { id: "image-2", title: "生成细节图", status: "pending" },
];
const actions = { submitting: false, onApprove: () => {}, onReject: () => {} };

async function withReview(run: (host: HTMLDivElement, render: (props: Partial<ComponentProps<typeof CreationAgentReview>>) => Promise<void>) => Promise<void>) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = async (props: Partial<ComponentProps<typeof CreationAgentReview>>) => {
        await act(async () => root.render(<CreationAgentReview {...actions} items={items} {...props} />));
    };
    try {
        await run(host, render);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
}

test("执行计划展开和收起控制整个列表，文案与规格一起隐藏", async () => {
    await withReview(async (host, render) => {
        await render({ outputPreference: "concise" });
        const toggle = () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        expect(host.textContent).not.toContain("生成场景图");
        expect(host.textContent).not.toContain("size 1:1");
        await act(async () => toggle().click());
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(toggle().textContent).toContain("收起");
        const list = document.getElementById(toggle().getAttribute("aria-controls")!);
        expect(list?.querySelectorAll("li")).toHaveLength(3);
        for (const text of ["生成场景图", "Daily use", "日常使用", "size 1:1"]) expect(list?.textContent).toContain(text);
        await act(async () => toggle().click());
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        expect(toggle().textContent).toContain("展开");
        for (const text of ["生成场景图", "Daily use", "日常使用", "size 1:1"]) expect(host.textContent).not.toContain(text);
    });
});

test("服务端逐项完成后更新计数和划线，未完成项保持原样", async () => {
    await withReview(async (host, render) => {
        await render({});
        expect(host.querySelector("button[aria-expanded]")?.textContent).toContain("1/3");
        expect(Array.from(host.querySelectorAll("s")).map((entry) => entry.textContent)).toEqual(["规划套图"]);
        expect(host.querySelector('svg[aria-label="执行中"]')).not.toBeNull();
        expect(host.querySelector('svg[aria-label="待执行"]')).not.toBeNull();
        await render({ items: items.map((item) => (item.id === "image-1" ? { ...item, status: "done" } : item)) });
        expect(host.querySelector("button[aria-expanded]")?.textContent).toContain("2/3");
        expect(Array.from(host.querySelectorAll("s")).map((entry) => entry.textContent)).toEqual(["规划套图", "生成场景图"]);
        expect(host.querySelector('svg[aria-label="执行中"]')).toBeNull();
        await render({ items: items.map((item) => ({ ...item, status: "done" })) });
        expect(host.querySelector("button[aria-expanded]")?.textContent).toContain("3/3");
        expect(host.querySelectorAll("s")).toHaveLength(3);
    });
});

test("计划进度刷新保留手动折叠状态，收起时审批仍可操作", async () => {
    await withReview(async (host, render) => {
        const approved: string[] = [];
        const props: Partial<ComponentProps<typeof CreationAgentReview>> = {
            outputPreference: "detailed",
            onApprove: () => {
                approved.push("approve");
            },
            approval: { approvalId: "approval", call: { id: "call", function: { name: "generate_media", arguments: "{}" } } },
        };
        await render(props);
        const toggle = () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
        await act(async () => toggle().click());
        await render({ ...props, items: items.map((item) => ({ ...item, status: "done" })) });
        expect(toggle().getAttribute("aria-expanded")).toBe("false");
        expect(toggle().textContent).toContain("3/3");
        expect(host.textContent).not.toContain("生成场景图");
        const approve = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "批准执行")!;
        await act(async () => approve.click());
        expect(approved).toEqual(["approve"]);
        await act(async () => toggle().click());
        await render({ ...props, items: items.map((item) => ({ ...item, status: "done" })) });
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(host.querySelectorAll("s")).toHaveLength(3);
    });
});

test("电商重要信息与阶段计划同时展示，独立折叠且进度更新不重置展开状态", async () => {
    await withReview(async (host, render) => {
        const plan = {
            planVersion: "2",
            planId: "five",
            version: 1,
            intent: "生成五张商品图",
            platform: "mercado_libre",
            site: "MX",
            language: "es",
            productFacts: [],
            styleBible: "统一蓝色视觉",
            items: [{ id: "hero", type: "image", title: "主视觉", purpose: "商品主视觉", prompt: "产品置于柔和日光下", targetCopy: "Cuidado diario", zhReviewCopy: "日常护理", attachmentResourceIds: [] }],
        };
        const stages: CreationAgentPlanItem[] = [
            { id: "visual", title: "锁定视觉方案", status: "done" },
            { id: "copy", title: "规划文案", status: "done" },
            { id: "generate", title: "生成最终图片", status: "doing" },
        ];
        await render({ plan, items: stages });
        const information = () => host.querySelector<HTMLButtonElement>('button[aria-label$="重要信息"]')!;
        const execution = () => host.querySelector<HTMLButtonElement>('button[aria-label$="执行计划"]')!;
        expect(information()).not.toBeNull();
        expect(execution()).not.toBeNull();
        expect(information().getAttribute("aria-controls")).not.toBe(execution().getAttribute("aria-controls"));
        expect(host.textContent).toContain("产品置于柔和日光下");
        expect(host.textContent).toContain("锁定视觉方案");
        await act(async () => execution().click());
        expect(host.textContent).not.toContain("生成最终图片");
        expect(host.textContent).toContain("产品置于柔和日光下");
        await act(async () => information().click());
        await act(async () => execution().click());
        expect(host.textContent).not.toContain("产品置于柔和日光下");
        expect(host.textContent).toContain("生成最终图片");
        await render({ plan, items: stages.map((item) => ({ ...item, status: "done" })) });
        expect(information().getAttribute("aria-expanded")).toBe("false");
        expect(execution().getAttribute("aria-expanded")).toBe("true");
        expect(execution().textContent).toContain("3/3");
        expect(Array.from(host.querySelectorAll("s")).map((item) => item.textContent)).toEqual(stages.map((item) => item.title));
        expect(host.textContent).toContain("生成五张商品图");
    });
});
