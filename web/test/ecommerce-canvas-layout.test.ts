import { expect, test } from "bun:test";
import { commerceCanvasAspect, commerceCanvasLayout } from "../src/pages/ecommerce/canvas-layout";

test("四图横向套版与多排套版保持模型真实比例", () => {
    expect(commerceCanvasAspect("1152x2048")).toBe(9 / 16);
    expect(commerceCanvasAspect("9:16")).toBe(9 / 16);
    expect(commerceCanvasAspect("auto")).toBe(1);
    expect(commerceCanvasLayout(4, "9:16")).toEqual({ columns: 4, width: 1124, height: (260 * 16) / 9 });
    expect(commerceCanvasLayout(1, "4:3")).toEqual({ columns: 1, width: 260, height: 195 });
    expect(commerceCanvasLayout(8, "1:1")).toEqual({ columns: 4, width: 1124, height: 548 });
});
