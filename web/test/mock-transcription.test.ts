import { describe, expect, test } from "bun:test";

import { mockTranscriptionEntries } from "@/lib/timeline/mock-transcription";

describe("mockTranscriptionEntries", () => {
    test("生成结果确定性：同输入同输出", () => {
        expect(mockTranscriptionEntries("采访素材 A", 12_000)).toEqual(mockTranscriptionEntries("采访素材 A", 12_000));
    });

    test("条目区间单调递增且落在时长内", () => {
        const entries = mockTranscriptionEntries("测试素材", 12_000);
        expect(entries.length).toBeGreaterThan(0);
        for (let i = 0; i < entries.length; i += 1) {
            const e = entries[i];
            expect(e.startMs).toBeGreaterThanOrEqual(0);
            expect(e.endMs).toBeLessThanOrEqual(12_000);
            expect(e.endMs).toBeGreaterThan(e.startMs);
            if (i > 0) expect(e.startMs).toBeGreaterThanOrEqual(entries[i - 1].endMs);
        }
    });

    test("空标题回退默认文本；过短时长返回空或受步长约束", () => {
        const entries = mockTranscriptionEntries("", 12_000);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].text).not.toBe("");
    });
});
