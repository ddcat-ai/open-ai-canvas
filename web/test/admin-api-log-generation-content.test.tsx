import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { splitApiLogPrompt } from "../src/pages/admin/logs/generation-content";
import type { ApiLogGenerationReference } from "../src/services/api/auth";

const references: ApiLogGenerationReference[] = [
    { id: "image-1", kind: "image", label: "图片1", name: "商品原图.png", available: true },
    { id: "image-10", kind: "image", label: "图片10", name: "角色.png", available: true },
    { id: "video-1", kind: "video", label: "视频1", name: "动作.mp4", available: true },
    { id: "audio-1", kind: "audio", label: "音频1", name: "配音.wav", available: false },
];

describe("video request prompt references", () => {
    test("restores repeated, multi-digit and Chinese-adjacent references with original text", () => {
        const prompt = "用@图片1还原商品，@图片10的角色按@视频1移动，声音用@音频1。再看@图片1。";
        const parts = splitApiLogPrompt(prompt, references);
        expect(parts.map((part) => part.text).join("")).toBe(prompt);
        expect(parts.filter((part) => part.type === "reference").map((part) => part.reference.id)).toEqual(["image-1", "image-10", "video-1", "audio-1", "image-1"]);
    });
    test("keeps unknown numbers, addresses and literal HTML as text", () => {
        const prompt = "@图片100 @视频2 a@image1.com https://example.test/@图片1 <script>x</script> @未知";
        expect(splitApiLogPrompt(prompt, references)).toEqual([{ type: "text", text: prompt }]);
    });
    test("supports reference aliases without mixing media kinds", () => {
        const parts = splitApiLogPrompt("@参考图1 @图1 @Image10 @Video1 @Audio1", references);
        expect(parts.filter((part) => part.type === "reference").map((part) => part.reference.id)).toEqual(["image-1", "image-1", "image-10", "video-1", "audio-1"]);
        expect(splitApiLogPrompt("", references)).toEqual([]);
        expect(splitApiLogPrompt("@图片1", [])).toEqual([{ type: "text", text: "@图片1" }]);
    });
});

test("request generation card renders original media and reference interactions in isolated DOM", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/admin-api-log-generation-content.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
}, 60000);
