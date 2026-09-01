import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("create empty state keeps the banner and composer in document flow", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
    const layoutStart = styles.indexOf("/* 空态布局收敛：保持图片区、文案和输入区的文档流顺序");
    const layoutEnd = styles.indexOf("/* ===== 素材库", layoutStart);
    const layout = styles.slice(layoutStart, layoutEnd);

    expect(layoutStart).toBeGreaterThanOrEqual(0);
    expect(layoutEnd).toBeGreaterThan(layoutStart);
    expect(layout).toContain("justify-content: flex-start;");
    expect(layout).toContain("flex: 0 0 auto;");
    expect(layout).toContain("margin: 0 auto 20px;");
    expect(layout).not.toContain("margin: auto auto 20px;");
    expect(layout).not.toContain("margin: 26px auto auto;");
});
