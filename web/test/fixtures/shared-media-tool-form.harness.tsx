import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
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
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MediaToolParameterFields } = await import("@/components/canvas/canvas-video-processing-dialog");
const { videoProcessingFields } = await import("@/lib/canvas/canvas-video-processing");
const { defaultConfig, createModelChannel, encodeChannelModel } = await import("@/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("@/lib/model-capabilities");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

test("共享真实参数表单保留数字类型、支持清空，处理工具不显示无效字段", async () => {
    const profile = defaultModelCapabilityConfig("volcengine-mediakit-video-enhance");
    const config = { ...defaultConfig, channels: [createModelChannel({ id: "enhance", scope: "system", models: ["m"], modelCosts: [{ model: "m", capability: "video", capabilityConfig: profile }] })] };
    const fields = videoProcessingFields(config, encodeChannelModel("enhance", "m"), "enhance");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let values: Record<string, string | number | undefined> = { bitrate: 1000 };
    const render = () =>
        root.render(
            <MediaToolParameterFields
                fields={fields}
                values={values}
                onChange={(key, value) => {
                    values = { ...values, [key]: value };
                    render();
                }}
            />,
        );
    try {
        await act(render);
        const input = host.querySelector<HTMLInputElement>('input[aria-label="精确码率"]');
        expect(input).not.toBeNull();
        const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!;
        await act(async () => {
            setValue.call(input, "2000");
            input!.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        });
        expect(values.bitrate).toBe(2000);
        await act(async () => {
            setValue.call(input, "");
            input!.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        });
        expect(values.bitrate).toBeUndefined();
        await act(async () => root.render(<MediaToolParameterFields fields={videoProcessingFields(config, "", "upscale")} values={{}} onChange={() => {}} />));
        expect(host.querySelectorAll("input").length).toBe(0);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
