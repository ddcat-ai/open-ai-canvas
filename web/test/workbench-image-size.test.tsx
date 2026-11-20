import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageSizePicker } from "../src/components/image-size-picker";
import { ImageParameterFields } from "../src/components/image-parameter-fields";
import { imageDeclaredSizePresets, imagePresetValue, imageSizePresets, imageTierAvailable } from "../src/lib/image-size-presets";
import { imageParameterRequest, projectImageParameters, type ImageParameter } from "../src/lib/image-parameters";
import { defaultImageCapabilityConfig, normalizeImageValue } from "../src/lib/model-capabilities";
import type { AiConfig } from "../src/stores/use-config-store";

// 参数声明模型的典型配置：比例在 size 参数里、档位在 imageResolution 参数里（大写），没有 size.presets。
const declaredRatios = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "21:9"];
const declaredParameters: ImageParameter[] = [
    { name: "size", label: "画面比例", type: "string", values: declaredRatios, default: "1:1", binding: "aspectRatio", enabled: true },
    { name: "imageResolution", label: "分辨率", type: "string", values: ["1K", "2K", "4K"], default: "1K", pricing: true, binding: "resolution", enabled: true },
    { name: "count", label: "生成张数", type: "integer", min: 1, max: 1, step: 1, default: 1, binding: "imageCount", enabled: true },
];

function declaredProfile() {
    const base = defaultImageCapabilityConfig();
    // 服务端 capabilityConfig 声明的是 aspect_ratio，projectImageParameters 负责把参数投影成能力配置。
    return projectImageParameters({ ...base, size: { ...base.size, parameter: "aspect_ratio" } }, declaredParameters);
}

function ratioButtonCount(html: string) {
    return (html.match(/class="image-size-ratio-icon"/g) || []).length;
}

describe("图片工作台的参数声明尺寸兜底", () => {
    test("画布和创作页数据源不变：imageSizePresets 仍为空，ImageParameterFields 仍逐字段渲染", () => {
        const profile = declaredProfile();
        expect(profile.size.presets).toBeUndefined();
        expect(imageSizePresets(profile)).toEqual([]);
        expect(imageDeclaredSizePresets(profile)).toHaveLength(30);

        const fields = renderToStaticMarkup(<ImageParameterFields profile={profile} config={{} as AiConfig} onChange={() => {}} />);
        expect(fields).toContain('role="group" aria-label="画面比例"');
        expect(fields).not.toContain("未配置预设尺寸");
        // 逐字段渲染不带工作台 picker 的 title/输出行。
        expect(fields).not.toContain("image-size-label");
        expect(fields).not.toContain('title="1:1 ·');
    });

    test("工作台选项为 10 个比例 × 1K/2K/4K，档位使用声明原值", () => {
        const profile = declaredProfile();
        const presets = imageDeclaredSizePresets(profile);
        expect([...new Set(presets.map((preset) => preset.ratio))]).toEqual(declaredRatios);
        expect([...new Set(presets.map((preset) => preset.tier))]).toEqual(["1k", "2k", "4k"]);
        expect(new Set(presets.map((preset) => `${preset.tier}:${preset.ratio}`)).size).toBe(30);
        expect(imageTierAvailable(profile, "2K")).toBe(true);

        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        expect(ratioButtonCount(picker)).toBe(10);
        for (const ratio of declaredRatios) expect(picker).toContain(`<span>${ratio}</span>`);
        for (const tier of ["1K", "2K", "4K"]) expect(picker).toMatch(new RegExp(`<button[^>]*>${tier}</button>`));
        expect(picker).toMatch(/title="16:9 · 2752 × 1536" aria-pressed="true"/);
        expect(picker).toContain("16:9 · 2752 × 1536 px");
    });

    test("未开启兜底时 picker 行为保持原样（其他页面不受影响）", () => {
        const profile = declaredProfile();
        const plain = renderToStaticMarkup(<ImageSizePicker profile={profile} size="16:9" imageResolution="2K" onChange={() => {}} />);
        expect(ratioButtonCount(plain)).toBe(0);
        expect(plain).toContain("未配置预设尺寸");
    });

    test("选 16:9 + 2K 后的请求值是声明原值，可直接用于提交与报价", () => {
        const profile = declaredProfile();
        const preset = imageDeclaredSizePresets(profile).find((item) => item.tier === "2k" && item.ratio === "16:9")!;
        // 与 ImageSizePicker.select 的取值路径一致：比例取 preset.ratio，分辨率按 tier 回查声明值。
        const pickedSize = imagePresetValue(profile, preset);
        const pickedResolution = profile.resolution.values.find((value) => value.trim().toLowerCase() === preset.tier);
        expect(pickedSize).toBe("16:9");
        expect(pickedResolution).toBe("2K");
        // 提交链路使用 normalizeImageValue + imageParameterRequest，二者都必须保留声明大小写。
        expect(imageParameterRequest(profile, { size: pickedSize, imageResolution: pickedResolution, quality: "auto", count: "1" }, true)).toEqual({
            size: "16:9",
            imageResolution: "2K",
            count: 1,
        });
        const normalized = normalizeImageValue(profile, { size: pickedSize, imageResolution: pickedResolution, quality: "auto", count: "1" });
        expect(normalized.size).toBe("16:9");
        expect(normalized.imageResolution).toBe("2K");
    });

    test("点击比例和档位回传声明原值", async () => {
        const { Window } = await import("happy-dom");
        const dom = new Window({ url: "http://localhost/" });
        const originals = new Map<string, PropertyDescriptor | undefined>();
        for (const [key, value] of Object.entries({
            window: dom,
            document: dom.document,
            navigator: dom.navigator,
            HTMLElement: dom.HTMLElement,
            Element: dom.Element,
            Node: dom.Node,
            SVGElement: dom.SVGElement,
            getComputedStyle: dom.getComputedStyle.bind(dom),
            IS_REACT_ACT_ENVIRONMENT: true,
        })) {
            originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
            Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
        }
        try {
            const { act } = await import("react");
            const { createRoot } = await import("react-dom/client");
            const host = document.createElement("div");
            document.body.append(host);
            const changes: Array<[string, string | undefined, string | undefined]> = [];
            const root = createRoot(host);
            await act(async () => root.render(<ImageSizePicker profile={declaredProfile()} size="16:9" imageResolution="2K" declaredSizeOptions onChange={(size, quality, resolution) => changes.push([size, quality, resolution])} />));
            const ratio = [...host.querySelectorAll("button")].find((button) => button.textContent === "16:9")!;
            await act(async () => ratio.dispatchEvent(new dom.MouseEvent("click", { bubbles: true })));
            const oneK = [...host.querySelectorAll("button")].find((button) => button.textContent === "1K")!;
            await act(async () => oneK.dispatchEvent(new dom.MouseEvent("click", { bubbles: true })));
            await act(async () => root.unmount());
            expect(changes).toEqual([
                ["16:9", undefined, "2K"],
                ["16:9", undefined, "1K"],
            ]);
        } finally {
            for (const [key, value] of originals) {
                if (value) Object.defineProperty(globalThis, key, value);
                else Reflect.deleteProperty(globalThis, key);
            }
            dom.happyDOM.abort();
        }
    });

    test("auto 与 4:1/8:1/9:21 等声明原值不丢失，auto 仍由现有按钮处理", () => {
        const base = defaultImageCapabilityConfig();
        const profile = projectImageParameters({ ...base, size: { ...base.size, parameter: "aspect_ratio" } }, [
            { name: "size", label: "画面比例", type: "string", values: ["auto", "1:1", "4:1", "8:1", "9:21"], default: "1:1", enabled: true },
            { name: "imageResolution", label: "分辨率", type: "string", values: ["1K", "2K", "4K"], default: "1K", enabled: true },
        ]);
        const options = imageDeclaredSizePresets(profile).filter((preset) => preset.tier === "2k");
        expect(options.map((preset) => preset.ratio)).toEqual(["1:1", "4:1", "8:1", "9:21"]);
        expect(options.find((preset) => preset.ratio === "9:21")?.ratio).toBe("9:21");

        const picker = renderToStaticMarkup(<ImageSizePicker profile={profile} size="9:21" imageResolution="2K" declaredSizeOptions onChange={() => {}} />);
        expect(picker).toContain("<span>9:21</span>");
        expect(picker).toContain(">自动尺寸<");
        expect(imageParameterRequest(profile, { size: "9:21", imageResolution: "2K" }, true)).toMatchObject({ size: "9:21", imageResolution: "2K" });
    });
});
