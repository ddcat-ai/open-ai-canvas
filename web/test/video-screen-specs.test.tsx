import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelCapabilityEditor } from "../src/components/model-capability-editor";
import { defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeModelCapabilityConfig, normalizeVideoValue } from "../src/lib/model-capabilities";
import type { ModelProtocolWorkflow } from "../src/lib/model-protocols";
import { resolveWorkflowVideoScreenSpec, updateWorkflowVideoScreenSpec } from "../src/lib/video-screen-specs";

const workflow: ModelProtocolWorkflow = {
    id: "minimax_h3_zm_u24",
    label: "H3 ZM U24",
    providerId: "autodl-comfyui",
    capability: "video",
    parameters: [{ name: "resolution", mapping: "resolution", type: "string", values: ["480p竖", "768p竖", "480p横", "768p横", "480p(1:1)", "768p(1:1)"] }],
    defaults: { resolution: "768p竖" },
};
const initial = () => resolveWorkflowVideoScreenSpec(defaultModelCapabilityConfig("autodl-comfyui", workflow.id).video!, workflow);

test("removed switch and draft cannot replace the effective six choices", () => {
    for (const customSizeEnabled of [false, true]) {
        const original = Object.assign(initial(), {
            customSizeEnabled,
            customScreenSpec: { ratios: ["2:3"], defaultRatio: "2:3", resolutions: ["invalid"], defaultResolution: "missing" },
        });
        const resolved = resolveWorkflowVideoScreenSpec(original, workflow);
        expect(resolved.resolutions).toEqual(workflow.parameters[0]!.values!);
        expect(resolved.defaultResolution).toBe("768p竖");
        expect(resolved.ratios).toEqual([]);
        expect(resolved.duration).toEqual(original.duration);
        expect(resolved.references).toEqual(original.references);
        expect(resolved.operations).toEqual(original.operations);
    }
});

test("selected presets and default remain active after saving and reloading", () => {
    const profile = updateWorkflowVideoScreenSpec(initial(), workflow, { resolutions: [" 480p横 ", "768p(1:1)", "480P横", ""], defaultResolution: " 768P(1:1) " });
    const reloaded = normalizeModelCapabilityConfig(JSON.parse(JSON.stringify({ version: 1, video: profile }))).video!;
    expect(reloaded.resolutions).toEqual(["480p横", "768p(1:1)"]);
    expect(reloaded.defaultResolution).toBe("768p(1:1)");
    expect(normalizeVideoValue(reloaded, { seconds: "6", ratio: "16:9", resolution: "768p(1:1)" })).toEqual({ seconds: "6", ratio: "", resolution: "768p(1:1)" });
    expect(updateWorkflowVideoScreenSpec(profile, workflow, { resolutions: [], defaultResolution: "" }).resolutions).toEqual([]);
});

test("creation and canvas use configured choices and replace stale cached selections", () => {
    const profile = updateWorkflowVideoScreenSpec(initial(), workflow, { resolutions: ["480p横", "768p(1:1)"], defaultResolution: "768p(1:1)" });
    const config = { channels: [{ id: "autodl", models: [workflow.id], modelCosts: [{ model: workflow.id, protocol: "autodl-comfyui", capabilityConfig: { version: 1, video: profile } }] }] };
    const selected = modelCapabilityConfigFor(config, `autodl::${workflow.id}`).video!;
    expect(normalizeVideoValue(selected, { seconds: "6", ratio: "16:9", resolution: "768p竖" })).toEqual({ seconds: "6", ratio: "", resolution: "768p(1:1)" });
    expect(normalizeVideoValue(selected, { resolution: "480p横" }).resolution).toBe("480p横");
});

test("switching workflows refreshes the available presets without carrying foreign labels", () => {
    const previous = updateWorkflowVideoScreenSpec(initial(), workflow, { resolutions: ["480p横"], defaultResolution: "480p横" });
    const next = resolveWorkflowVideoScreenSpec(previous, { ...workflow, id: "z0901", parameters: [{ name: "resolution", type: "string", values: ["768p竖(768*1344)"] }], defaults: { resolution: "768p竖(768*1344)" } });
    expect(next.resolutions).toEqual(["768p竖(768*1344)"]);
    expect(next.defaultResolution).toBe("768p竖(768*1344)");
});

test("real editor keeps enabled fields and original card copy without switch or explanation", () => {
    for (const section of ["all", "protocol"] as const) {
        const html = renderToStaticMarkup(<ModelCapabilityEditor capability="video" protocol="autodl-comfyui" model={workflow.id} workflows={[workflow]} section={section} value={{ version: 1, video: initial() }} />);
        expect(html).not.toContain("自定义比例分辨率");
        expect(html).not.toContain("画幅由完整分辨率标签");
        expect(html).not.toContain("使用当前工作流的插件预设");
        expect(html).toContain("768p(1:1)");
        expect(html).toContain('aria-label="输出分辨率"');
        expect(html).toContain('aria-label="默认分辨率"');
        expect(html).not.toContain("ant-select-disabled");
        expect(html).not.toContain("支持比例");
        expect(html).not.toContain("默认比例");
        if (section === "protocol") {
            expect(html).toContain("画面规格");
            expect(html).toContain("控制比例、分辨率及默认输出");
        }
    }
});

test("other video protocols keep their existing settings and controls", () => {
    const profile = defaultModelCapabilityConfig("minimax-video").video!;
    expect(resolveWorkflowVideoScreenSpec(profile)).toBe(profile);
    const html = renderToStaticMarkup(<ModelCapabilityEditor capability="video" protocol="minimax-video" section="protocol" />);
    expect(html).not.toContain("自定义比例分辨率");
    expect(html).toContain("支持比例");
});
