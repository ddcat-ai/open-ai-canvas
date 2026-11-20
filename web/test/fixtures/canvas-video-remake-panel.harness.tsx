import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/remake" });
for (const name of ["document", "navigator", "localStorage", "HTMLElement", "SVGElement", "Element", "ShadowRoot", "Node", "NodeFilter", "MutationObserver", "ResizeObserver", "Event", "CustomEvent"] as const) {
    Object.defineProperty(globalThis, name, { value: dom[name], configurable: true, writable: true });
}
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { CanvasNodePromptPanel } = await import("@/components/canvas/canvas-node-prompt-panel");
const { buildVideoRemakeDraft } = await import("@/lib/canvas/canvas-video-remake");
const { buildCanvasNodeMentionReferenceMap } = await import("@/lib/canvas/canvas-resource-references");
const { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { CanvasNodeType } = await import("@/types/canvas");

afterAll(() => dom.happyDOM.abort());

test("空图片位可从实际生成面板补图，补图后仍需手动提交", async () => {
    const model = "seedance-2.0";
    const channel = createModelChannel({ id: "panel", interfaceType: "volcengine-ark-video", models: [model], modelCosts: [{ model, capability: "video", protocol: "volcengine-ark-video", billingMode: "per_second", unitPriceMicrocredits: 1 }] });
    const config = { ...defaultConfig, channels: [channel], videoModel: encodeChannelModel(channel.id, model) };
    useConfigStore.setState({ config });
    useUserStore.setState((state) => ({ features: { ...state.features, customChannelsEnabled: true, creditsEnabled: false } }));
    const source: CanvasNodeData = { id: "clip", type: CanvasNodeType.Video, title: "样片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "clip.mp4", durationMs: 6000 } };
    const draft = buildVideoRemakeDraft(source.id, [source], [], config);
    const submissions: string[] = [];
    function Panel({ durationMs }: { durationMs: number }) {
        const [imageUploaded, setImageUploaded] = useState(false);
        const nodes = draft.nodes.map((node) => {
            if (node.id === source.id) return { ...node, metadata: { ...node.metadata, durationMs } };
            if (node.type === CanvasNodeType.Image && imageUploaded) return { ...node, metadata: { content: "portrait.png" } };
            return node;
        });
        return (
            <CanvasNodePromptPanel
                projectId="remake"
                node={draft.target}
                isRunning={false}
                mentionReferences={buildCanvasNodeMentionReferenceMap(nodes, draft.connections).get(draft.target.id)}
                onPromptChange={() => {}}
                onConfigChange={() => {}}
                onGenerate={(_id, _mode, prompt) => submissions.push(prompt)}
                onUploadRemakeImage={() => setImageUploaded(true)}
            />
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderPanel = (durationMs: number) =>
        act(async () =>
            root.render(
                <QueryClientProvider client={client}>
                    <App>
                        <Panel durationMs={durationMs} />
                    </App>
                </QueryClientProvider>,
            ),
        );
    try {
        await renderPanel(16000);
        const submit = host.querySelector<HTMLButtonElement>(".canvas-node-generate-button")!;
        expect(submit.disabled).toBe(true);
        expect(host.textContent).toContain("缺少参考图片");
        const upload = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("上传参考图"))!;
        await act(async () => upload.click());
        expect(host.textContent).not.toContain("缺少参考图片");
        expect(host.textContent).toContain("参考片段");
        expect(submit.disabled).toBe(true);
        await renderPanel(6000);
        expect(submit.disabled).toBe(false);
        expect(submissions).toEqual([]);
        await act(async () => submit.click());
        expect(submissions).toEqual([draft.target.metadata?.composerContent]);
    } finally {
        await act(async () => root.unmount());
        client.clear();
        host.remove();
    }
});
