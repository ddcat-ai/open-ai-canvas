import { describe, expect, test } from "bun:test";

import { buildLibTVImagePreviewUrl, formatLibTVBatchTime, parseLibTVProjectUUID } from "../src/lib/canvas/libtv-import";

describe("LibTV canvas import helpers", () => {
    test("extracts projectId from LibTV share links", () => {
        expect(parseLibTVProjectUUID("https://www.liblib.tv/canvas/share?spaceId=5858202&projectId=dda7684b670b4e57b6027f1334fe6056")).toBe("dda7684b670b4e57b6027f1334fe6056");
    });

    test("accepts direct UUIDs and rejects unrelated links", () => {
        expect(parseLibTVProjectUUID("292A69D540774A9AB9872D8337C9FD0B")).toBe("292a69d540774a9ab9872d8337c9fd0b");
        expect(parseLibTVProjectUUID("https://api.liblib.tv/api/canvas/project/detail?uuid=292a69d540774a9ab9872d8337c9fd0b")).toBe("292a69d540774a9ab9872d8337c9fd0b");
        expect(parseLibTVProjectUUID("https://example.com/not-a-canvas")).toBe("");
    });

    test("formats the readable batch label to local yyyyMMddHHmm", () => {
        const localTime = new Date(2026, 7, 19, 5, 2);
        expect(formatLibTVBatchTime(localTime.toISOString())).toBe("202608190502");
    });

    test("uses a LibTV CDN thumbnail without changing the original media contract", () => {
        const original = "https://libtv-res.liblib.art/path/example.png";
        expect(buildLibTVImagePreviewUrl(original)).toBe("https://libtv-res.liblib.art/path/example.png?x-oss-process=image%2Fresize%2Cw_960");
        expect(buildLibTVImagePreviewUrl("https://example.com/path/example.png")).toBe("https://example.com/path/example.png");
    });
});
