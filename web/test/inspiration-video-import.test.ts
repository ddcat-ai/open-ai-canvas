import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSeedanceEntries } from "../scripts/import-inspirations.mjs";

const sample = {
    slug: "test-video",
    title: "视频预览示例",
    posterUrl: "https://media.example.com/poster.jpg",
    promptFull: "电影镜头缓慢推进",
    mediaType: "video",
    mediaUrl: "https://media.example.com/clip.mp4",
};

describe("inspiration video import", () => {
    test("keeps the upstream video URL alongside the cover and prompt", () => {
        const [entry] = buildSeedanceEntries([sample]);
        expect(entry.videoUrl).toBe("https://media.example.com/clip.mp4");
        expect(entry.image).toBe(sample.posterUrl);
        expect(entry.prompt).toBe(sample.promptFull);
    });

    test("does not invent videos for missing, non-video or unsafe media", () => {
        for (const extra of [{ mediaUrl: undefined }, { mediaType: "image" }, { mediaUrl: "javascript:alert(1)" }]) {
            const [entry] = buildSeedanceEntries([{ ...sample, ...extra }]);
            expect(entry.videoUrl).toBeUndefined();
        }
    });

    test("the shipped catalog and gallery retain the verified diner video", () => {
        for (const file of ["seedance.json", "gallery-pool.json"]) {
            const catalog = JSON.parse(readFileSync(new URL(`../public/inspirations/${file}`, import.meta.url), "utf8"));
            const entry = catalog.entries.find((item: { id: string }) => item.id === "seedance:seedance-25-diner-frozen-time-rewind");
            expect(entry.videoUrl).toBe("https://media.goodcase.ai/media/video/seedance-25-diner-frozen-time-rewind.mp4");
        }
    });
});
