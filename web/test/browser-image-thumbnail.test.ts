import { expect, test } from "bun:test";
import { thumbnailDimensions } from "../src/lib/browser-image-thumbnail";

test("缩略图保持比例，不放大小图", () => {
    expect(thumbnailDimensions(2000, 1000, 400)).toEqual({ width: 400, height: 200 });
    expect(thumbnailDimensions(100, 200, 400)).toEqual({ width: 100, height: 200 });
    expect(thumbnailDimensions(1000, 2000, 400)).toEqual({ width: 200, height: 400 });
});

test("非法尺寸不能生成伪缩略图", () => {
    expect(() => thumbnailDimensions(0, 100)).toThrow();
    expect(() => thumbnailDimensions(Number.NaN, 100)).toThrow();
});
