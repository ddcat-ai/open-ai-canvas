import { describe, expect, test } from "bun:test";

import { unwrapEnvelope, videoTaskId } from "../src/services/api/video-response";
import { isPublicMediaUrl, normalizeVideoResolution, normalizeVideoSeconds, normalizeVideoSize } from "../src/services/api/video-validation";

describe("video API response contracts", () => {
    test("解包裸响应和后端 envelope", () => {
        expect(unwrapEnvelope({ id: "task-1" }, "缺少任务")).toEqual({ id: "task-1" });
        expect(unwrapEnvelope({ code: 0, data: { id: "task-2" }, msg: "ok" }, "缺少任务")).toEqual({ id: "task-2" });
        expect(videoTaskId({ request_id: "request-1" })).toBe("request-1");
    });

    test("业务失败和空数据不会被静默转换为成功", () => {
        expect(() => unwrapEnvelope({ code: 401, data: null, msg: "未授权" }, "缺少任务")).toThrow("未授权");
        expect(() => unwrapEnvelope({ code: 0, data: null, msg: "ok" }, "缺少任务")).toThrow("缺少任务");
    });
});

describe("video request normalization", () => {
    test("规范化时长、比例尺寸和分辨率", () => {
        expect(normalizeVideoSeconds("0")).toBe("6");
        expect(normalizeVideoSeconds("8.9")).toBe("8");
        expect(normalizeVideoSize("16:9")).toBe("1280x720");
        expect(normalizeVideoSize("auto")).toBeNull();
        expect(normalizeVideoResolution("low")).toBe("480p");
        expect(normalizeVideoResolution("2k")).toBe("1440p");
    });

    test("只把 HTTP(S) 地址视为公网媒体地址", () => {
        expect(isPublicMediaUrl("https://cdn.example.com/video.mp4")).toBe(true);
        expect(isPublicMediaUrl("http://localhost/video.mp4")).toBe(true);
        expect(isPublicMediaUrl("asset://resource-1")).toBe(false);
        expect(isPublicMediaUrl("data:video/mp4;base64,AAAA")).toBe(false);
        expect(isPublicMediaUrl("/resources/video.mp4")).toBe(false);
    });
});
