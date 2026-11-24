import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioSettingsPanel } from "../src/components/audio-settings-panel";
import { buildNodeConfig } from "../src/components/canvas/canvas-node-prompt-config";
import { canvasThemes } from "../src/lib/canvas-theme";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { readNodeGenerationSpec, specFromConfig, synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { canvasAudioSource } from "../src/lib/audio-generation";

const theme = Object.values(canvasThemes)[0];
const config = {
    ...defaultConfig,
    interfaceType: "doubao-streaming-tts",
    model: "seed-audio-1.0",
    audioModel: "seed-audio-1.0",
    channels: [createModelChannel({ id: "doubao", models: ["seed-audio-1.0"], interfaceType: "doubao-streaming-tts" })],
    audioVoice: "",
    audioSpeed: "",
};

describe("canvas audio settings", () => {
    test("stale voice bindings remain recoverable without crashing", () => {
        const html = renderToStaticMarkup(
            <AudioSettingsPanel
                config={{ ...config, audioMode: "unified_edit", audioVoiceBindings: [{ characterNodeId: "c", audioNodeId: "removed" }] }}
                referenceAudioLabels={["音频1"]}
                references={[
                    { id: "c", nodeId: "c", kind: "character", title: "角色", label: "角色1", active: true },
                    { id: "a", nodeId: "a", kind: "audio", title: "声音", label: "音频1", active: true },
                ]}
                onBindingsChange={() => {}}
                theme={theme}
                onConfigChange={() => {}}
            />,
        );
        expect(html).toContain("引用已失效");
        expect(html).not.toContain("试听 removed");
    });
    test("summarizes the effective mode and reference voice source", () => {
        expect(canvasAudioSource({ ...config, audioMode: "auto" }, ["音频1"]).label).toBe("参考音色：音频1");
        expect(canvasAudioSource({ ...config, audioMode: "unified_edit" }, ["音频1", "音频2"]).label).toBe("参考音色：2 段");
        expect(canvasAudioSource({ ...config, audioMode: "tts" }, ["音频1"]).label).toBe("文本朗读");
        expect(canvasAudioSource({ ...config, audioMode: "unified_edit" }, []).label).toBe("配音待选音色");
    });
    test("reference voice mode explains the source and hides unused voice and speed inputs", () => {
        const html = renderToStaticMarkup(<AudioSettingsPanel config={{ ...config, audioMode: "unified_edit" }} referenceAudioLabels={["音频1"]} theme={theme} onConfigChange={() => {}} />);
        expect(html).toContain("当前使用参考音色");
        expect(html).toContain("音频1");
        expect(html).not.toContain('aria-label="豆包音色 ID"');
        expect(html).not.toContain('aria-label="自定义语速"');
        expect(html).toContain('aria-label="音频格式"');
    });
    test("renders Doubao voice input and prompt guidance without unsupported controls", () => {
        const html = renderToStaticMarkup(<AudioSettingsPanel config={config} theme={theme} onConfigChange={() => {}} />);
        expect(html).toContain('aria-label="豆包音色 ID"');
        expect(html).toContain("豆包提示词写法");
        expect(html).toContain("@Audio1");
        expect(html).toContain("1x 为正常语速");
        expect(html).not.toContain('aria-label="声音指令"');
    });

    test("keeps explicit empty node voice instead of inheriting global voice", () => {
        const global = { ...config, audioVoice: "global-speaker" };
        const node = { id: "audio", type: CanvasNodeType.Audio, metadata: { audioVoice: "" } } as CanvasNodeData;
        expect(buildNodeConfig(global, node, "audio", { capability: "audio" }).audioVoice).toBe("");
        expect(buildNodeConfig(global, { ...node, metadata: {} }, "audio", { capability: "audio" }).audioVoice).toBe("global-speaker");
        const edited = synchronizeGenerationSpec({ ...node, metadata: { audioVoice: "old-speaker" } }, { audioVoice: "" });
        expect(readNodeGenerationSpec(edited)?.options.audioVoice).toBe("");
        expect(buildNodeConfig(global, edited, "audio", { capability: "audio" }).audioVoice).toBe("");
        expect(specFromConfig("audio", "你好", config).options.audioVoice).toBe("");
    });
});
