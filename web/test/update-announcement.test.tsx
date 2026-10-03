import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdateAnnouncementContent } from "../src/components/layout/update-announcement-content";
import { DEFAULT_UPDATE_ANNOUNCEMENT, moveUpdateItem, validateUpdateAnnouncement, updateAnnouncementVersion, type UpdateAnnouncement } from "../src/lib/update-announcement";
import { normalizePublicAppearance } from "../src/stores/use-appearance-store";
import { refreshPublicAppearance } from "../src/services/appearance-bootstrap";

const custom = (): UpdateAnnouncement => ({
    enabled: true,
    currentVersion: "影绘 2.0",
    releases: [
        {
            id: "r1",
            version: "影绘 2.0",
            title: "图文与视频公告",
            date: "2026-10-03",
            blocks: [
                { id: "text", type: "text", text: "**新功能**\n\n- 内容一\n- 内容二", resourceId: "", caption: "", layout: "full" },
                { id: "image", type: "image", text: "", resourceId: "image1", caption: "功能示意", layout: "half", mediaUrl: "/api/public/appearance/updates/image1" },
                { id: "video", type: "video", text: "", resourceId: "video1", caption: "视频演示", layout: "half", mediaUrl: "/api/public/appearance/updates/video1" },
            ],
        },
    ],
});

test("switch selects the custom display version and restores the real version", () => {
    expect(updateAnnouncementVersion(custom(), "1.6.0")).toBe("影绘 2.0");
    expect(updateAnnouncementVersion({ ...custom(), enabled: false }, "v1.6.0")).toBe("v1.6.0");
    expect(updateAnnouncementVersion(undefined, "1.6.0")).toBe("v1.6.0");
});
test("old appearance data defaults to the original log", () => {
    expect(normalizePublicAppearance({}).updates).toEqual(DEFAULT_UPDATE_ANNOUNCEMENT);
});
test("publication rejects missing versions, duplicate versions, and incomplete media", () => {
    expect(validateUpdateAnnouncement(custom())).toBeUndefined();
    expect(validateUpdateAnnouncement({ ...DEFAULT_UPDATE_ANNOUNCEMENT, enabled: true })).toBeDefined();
    const value = custom();
    value.releases[0].blocks[1].resourceId = "";
    expect(validateUpdateAnnouncement(value)).toBeDefined();
    const duplicate = custom();
    duplicate.releases.push({ ...duplicate.releases[0], id: "r2" });
    expect(validateUpdateAnnouncement(duplicate)).toBeDefined();
});
test("reorder preserves content identity and does not modify the source", () => {
    const blocks = custom().releases[0].blocks;
    expect(moveUpdateItem(blocks, 2, -1).map((block) => block.id)).toEqual(["text", "video", "image"]);
    expect(blocks.map((block) => block.id)).toEqual(["text", "image", "video"]);
    expect(moveUpdateItem(blocks, 0, -1)).toBe(blocks);
});
test("real renderer supports text, images, videos, dates and responsive half layout", () => {
    const html = renderToStaticMarkup(<UpdateAnnouncementContent value={custom()} />);
    expect(html).toContain("<strong>新功能</strong>");
    expect(html).toContain("is-half");
    expect(html).toContain('alt="功能示意"');
    expect(html).toContain("<video");
    expect(html).toContain('controls=""');
    expect(html).toMatch(/datetime="2026-10-03"/i);
});
test("renderer escapes raw HTML and blocks inline Markdown images", () => {
    const value = custom();
    value.releases[0].blocks[0].text = "<script>alert(1)</script>\n\n![hidden](https://example.com/tracker.png)";
    const html = renderToStaticMarkup(<UpdateAnnouncementContent value={value} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("tracker.png");
});
test("appearance refresh carries the saved announcement switch and version", async () => {
    const result = await refreshPublicAppearance(async () => normalizePublicAppearance({ updates: custom() }));
    expect(result?.updates?.currentVersion).toBe("影绘 2.0");
    expect(result?.updates?.enabled).toBe(true);
});
