import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { localizeInspirationEntries } from "../scripts/inspiration-localization.mjs";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const original = { id: "seedance:sample", prompt: "A slow tracking shot, 16:9, 10 seconds.", image: "/cover.webp", videoUrl: "https://example.com/video.mp4", sourceUrl: "https://example.com/source" };

describe("Chinese inspiration catalogs", () => {
    test("replaces the complete prompt while preserving media, identity and attribution", () => {
        const translated = "缓慢跟拍镜头，16:9，10 秒。";
        const [entry] = localizeInspirationEntries([original], { [original.id]: { sourceHash: hash(original.prompt), prompt: translated } });
        expect(entry).toEqual({ ...original, prompt: translated });
        expect(original.prompt).toStartWith("A slow");
    });

    test("uses the source's existing Chinese text without publishing a second English body", () => {
        const [entry] = localizeInspirationEntries([{ ...original, promptZh: "原站提供的完整中文提示词。" }], {});
        expect(entry.prompt).toBe("原站提供的完整中文提示词。");
        expect(entry.promptZh).toBeUndefined();
    });

    test("rejects missing, outdated and non-Chinese translations instead of restoring English", () => {
        for (const records of [{}, { [original.id]: { sourceHash: hash("old prompt"), prompt: "旧翻译" } }, { [original.id]: { sourceHash: hash(original.prompt), prompt: "Still English" } }]) {
            expect(() => localizeInspirationEntries([original], records)).toThrow();
        }
    });

    test("every shipped catalog prompt is Chinese and the gallery uses the same complete text", () => {
        const all = new Map<string, string>();
        for (const name of ["seedance", "haohaoxue", "youmind"]) {
            const pack = JSON.parse(readFileSync(new URL(`../public/inspirations/${name}.json`, import.meta.url), "utf8"));
            for (const item of pack.entries) {
                expect(item.prompt).toMatch(/[\u3400-\u9fff]/);
                expect(item.promptZh).toBeUndefined();
                all.set(item.id, item.prompt);
            }
        }
        const gallery = JSON.parse(readFileSync(new URL("../public/inspirations/gallery-pool.json", import.meta.url), "utf8"));
        for (const item of gallery.entries) expect(item.prompt).toBe(all.get(item.id));
    });
});
