import { describe, expect, it } from "bun:test";
import { assetProjectLabel, assetSizeLabel } from "@/pages/assets/asset-library-format";
import type { Asset } from "@/stores/use-asset-store";

describe("asset library format", () => {
    it("shows real media dimensions", () => {
        expect(assetSizeLabel(768, 1344)).toBe("768x1344");
        expect(assetSizeLabel(2, 3)).toBe("2x3");
    });

    it("treats zero, missing and the legacy 1x1 placeholder as unknown", () => {
        expect(assetSizeLabel(0, 0)).toBe("未知");
        expect(assetSizeLabel(1, 1)).toBe("未知");
        expect(assetSizeLabel(1080, 1)).toBe("未知");
        expect(assetSizeLabel(Number.NaN, 720)).toBe("未知");
    });

    it("labels drama assets by the project recorded in metadata", () => {
        const base: Asset = { id: "drama-res", kind: "video", title: "短剧视频", coverUrl: "", tags: [], createdAt: "", updatedAt: "", data: { url: "", storageKey: "resource:res", width: 0, height: 0, bytes: 1, mimeType: "video/mp4" } };
        expect(assetProjectLabel(base)).toBe("未关联项目");
        expect(assetProjectLabel({ ...base, metadata: { projectIds: ["prj-1"] } })).toBe("已关联项目");
        expect(assetProjectLabel({ ...base, metadata: { projectIds: ["prj-1"], projectName: "斗破" } })).toBe("斗破");
    });
});
