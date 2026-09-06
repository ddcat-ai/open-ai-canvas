import { describe, expect, test } from "bun:test";

import { videoDurationScalePosition, videoDurationScaleTicks } from "../src/lib/video-duration-scale";

describe("video duration scale", () => {
    test("uses readable major ticks without implying a zero-second Dreamina duration", () => {
        expect(videoDurationScaleTicks(4, 30, 1).map((tick) => tick.value)).toEqual([4, 10, 15, 20, 25, 30]);
    });

    test("keeps compact model ranges selectable at each whole second", () => {
        expect(videoDurationScaleTicks(2, 8, 1).map((tick) => tick.value)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    });

    test("clamps scale positions to the supported model range", () => {
        expect(videoDurationScalePosition(4, 4, 30)).toBe(0);
        expect(videoDurationScalePosition(17, 4, 30)).toBe(50);
        expect(videoDurationScalePosition(40, 4, 30)).toBe(100);
    });
});
