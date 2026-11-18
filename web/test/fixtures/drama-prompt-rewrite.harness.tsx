import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaSegment } from "@/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/drama" });
Object.assign(globalThis, {
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
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SegmentPromptRewrite } = await import("@/pages/projects/studio/segment-prompt-rewrite");
const { rewriteDramaVideoPrompt } = await import("@/services/drama-prompt-rewrite");
const generation = await import("@/services/api/generation-task");
const { defaultConfig, createModelChannel, useConfigStore } = await import("@/stores/use-config-store");
const channel = createModelChannel({ id: "text-channel", scope: "system", models: ["text-model"], modelCosts: [{ model: "text-model", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 0 }] });
const config = { ...defaultConfig, channels: [channel] };
const model = { channelId: channel.id, modelKey: "text-model" };
const segment = { id: "segment-1", revision: 1, request: { seconds: 5, header: "参考图1：主角", promptMaxChars: 500, references: [{ label: "参考图1", name: "主角" }] } } as DramaSegment;

test("候选保留原稿、按新要求继续修改、显式采用及过期结果阻止覆盖", async () => {
    useConfigStore.setState({ config });
    const calls: Parameters<typeof generation.runBackendGenerationTask>[0][] = [];
    const upstream = spyOn(generation, "runBackendGenerationTask").mockImplementation(async (input) => {
        calls.push(input);
        return { text: `参考图1在远景中对峙，候选${calls.length}。` };
    });
    const applied: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let prompt = "参考图1参与打斗。";
    let currentSegment = segment;
    const render = () => root.render(<SegmentPromptRewrite projectId="project-1" episodeId="episode-1" segment={currentSegment} prompt={prompt} model={model} disabled={false} onApply={async (value) => applied.push(value)} />);
    const click = async (text: string) => {
        await act(async () => {
            const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
            expect(button).toBeDefined();
            button!.click();
        });
    };
    const instruction = async (value: string) => {
        await act(async () => {
            const field = host.querySelector<HTMLTextAreaElement>('[aria-label="提示词修改要求"]')!;
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
            field.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
    };
    try {
        await act(async () => render());
        await instruction("改成对峙，去掉血腥描写");
        await click("生成修改候选");
        expect(applied).toEqual([]);
        expect(calls[0]).toMatchObject({ mode: "text", projectId: "project-1", metadata: { episodeId: "episode-1", segmentId: "segment-1" } });
        expect(JSON.parse(calls[0].prompt)).toMatchObject({ currentPrompt: prompt, instruction: "改成对峙，去掉血腥描写", references: [{ label: "参考图1", name: "主角" }] });
        await instruction("保留对峙，镜头改为远景");
        await click("按新要求继续修改");
        expect(JSON.parse(calls[1].prompt).currentPrompt).toContain("候选1");
        expect(applied).toEqual([]);
        await click("采用这版提示词");
        expect(applied).toEqual(["参考图1在远景中对峙，候选2。"]);
        await click("生成修改候选");
        prompt = "人工更新后的提示词";
        await act(async () => render());
        const apply = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes("采用这版提示词"))!;
        expect(apply.disabled).toBe(true);
        expect(host.textContent).toContain("本段内容已变化");
        await click("生成修改候选");
        expect(JSON.parse(calls.at(-1)!.prompt).currentPrompt).toBe(prompt);
        currentSegment = { ...segment, revision: segment.revision + 1 };
        await act(async () => render());
        expect(apply.disabled).toBe(true);
        await click("采用这版提示词");
        expect(applied).toHaveLength(1);
        await click("生成修改候选");
        const candidate = host.querySelector<HTMLTextAreaElement>('[aria-label="AI 修改候选"]')!.value;
        upstream.mockRejectedValueOnce(new Error("文本模型暂时不可用"));
        await instruction("进一步减少冲突描写");
        await click("按新要求继续修改");
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 修改候选"]')!.value).toBe(candidate);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("文本模型暂时不可用");
        expect(apply.disabled).toBe(false);
    } finally {
        upstream.mockRestore();
        await act(async () => root.unmount());
        host.remove();
    }
});

test("采用期间保留候选，保存失败后可直接重试，保存成功才清除", async () => {
    useConfigStore.setState({ config });
    const candidate = "参考图1在远景中对峙。";
    const upstream = spyOn(generation, "runBackendGenerationTask").mockResolvedValue({ text: candidate });
    const saves: string[] = [];
    let resolveSave: (value: unknown) => void = () => {};
    let rejectSave: (error: Error) => void = () => {};
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const button = (label: string) => {
        const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(label));
        expect(found).toBeDefined();
        return found!;
    };
    const click = async (label: string) => {
        await act(async () => button(label).click());
    };
    try {
        await act(async () => {
            root.render(
                <SegmentPromptRewrite
                    projectId="project-1"
                    episodeId="episode-1"
                    segment={segment}
                    prompt="参考图1参与打斗。"
                    model={model}
                    disabled={false}
                    onApply={(value) => {
                        saves.push(value);
                        return new Promise((resolve, reject) => {
                            resolveSave = resolve;
                            rejectSave = reject;
                        });
                    }}
                />,
            );
        });
        await act(async () => {
            const field = host.querySelector<HTMLTextAreaElement>('[aria-label="提示词修改要求"]')!;
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(field, "将打斗改为对峙");
            field.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        await click("生成修改候选");
        await click("采用这版提示词");
        expect(saves).toEqual([candidate]);
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 修改候选"]')!.value).toBe(candidate);
        expect(button("采用这版提示词").classList.contains("ant-btn-loading")).toBe(true);
        expect(button("按新要求继续修改").disabled).toBe(true);
        expect(button("放弃候选").disabled).toBe(true);
        await click("采用这版提示词");
        expect(saves).toHaveLength(1);
        await act(async () => rejectSave(new Error("保存失败，请重试")));
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("保存失败，请重试");
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="AI 修改候选"]')!.value).toBe(candidate);
        expect(button("采用这版提示词").classList.contains("ant-btn-loading")).toBe(false);
        expect(button("采用这版提示词").disabled).toBe(false);
        await click("采用这版提示词");
        expect(saves).toEqual([candidate, candidate]);
        expect(upstream).toHaveBeenCalledTimes(1);
        await act(async () => resolveSave({ saved: true }));
        expect(host.querySelector('[aria-label="AI 修改候选"]')).toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(button("生成修改候选").disabled).toBe(false);
    } finally {
        upstream.mockRestore();
        await act(async () => root.unmount());
        host.remove();
    }
});

test("空结果、超长结果、越界引用和模型不可用明确失败", async () => {
    const input = { projectId: "project-1", episodeId: "episode-1", segment, prompt: "参考图1在远景中。", instruction: "弱化冲突", model, config, signal: new AbortController().signal };
    const upstream = spyOn(generation, "runBackendGenerationTask");
    try {
        for (const [text, error] of [
            ["", "未返回"],
            ["长".repeat(501), "超过"],
            ["参考图2走入画面", "不存在"],
        ]) {
            upstream.mockResolvedValue({ text });
            await expect(rewriteDramaVideoPrompt(input)).rejects.toThrow(error);
        }
        upstream.mockRejectedValue(new Error("渠道不可用"));
        await expect(rewriteDramaVideoPrompt(input)).rejects.toThrow("渠道不可用");
        await expect(rewriteDramaVideoPrompt({ ...input, model: { channelId: "missing", modelKey: "missing" } })).rejects.toThrow("文本模型不可用");
    } finally {
        upstream.mockRestore();
    }
});
