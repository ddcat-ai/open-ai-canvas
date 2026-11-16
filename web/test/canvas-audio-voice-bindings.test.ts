import { describe, expect, test } from "bun:test";
import { canvasReferenceDisplayName } from "../src/lib/canvas/canvas-resource-references";
import { compileCanvasAudioVoiceBindings, normalizeCanvasAudioVoiceBindings } from "../src/lib/canvas/canvas-audio-voice-bindings";

describe("canvas audio voice bindings", () => {
    test("uses live titles without changing stable node identities", () => {
        const references = [
            { nodeId: "character", kind: "character", title: "陈默", label: "角色1" },
            { nodeId: "audio", kind: "audio", title: "老余", label: "音频2" },
        ];
        expect(canvasReferenceDisplayName({ ...references[1], id: "audio", active: true })).toBe("老余 · 音频2");
        expect(compileCanvasAudioVoiceBindings("台词", [{ characterNodeId: "character", audioNodeId: "audio" }], references)).toContain("陈默 → @音频2");
    });

    test("rejects stale references and duplicate characters", () => {
        expect(() => compileCanvasAudioVoiceBindings("台词", [{ characterNodeId: "character", audioNodeId: "missing" }], [{ nodeId: "character", kind: "character", label: "角色1" }])).toThrow("重新确认");
        expect(
            normalizeCanvasAudioVoiceBindings([
                { characterNodeId: "character", audioNodeId: "audio1" },
                { characterNodeId: "character", audioNodeId: "audio2" },
            ]),
        ).toHaveLength(1);
    });
});
