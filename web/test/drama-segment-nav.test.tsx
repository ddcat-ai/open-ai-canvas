import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 隔离 React 首次导入时的 DOM 能力，避免影响其他页面测试。
test("剧情段弹窗左右切换时生成设置卡片不会叠加", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/drama-segment-nav.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 60000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
}, 60000);

test("剧情段弹窗不会给同级子组件复用同一个 segment.id 作为 key", async () => {
    const source = await Bun.file(new URL("../src/pages/projects/studio/segment-dialog.tsx", import.meta.url)).text();
    const toolbar = source.slice(source.indexOf("<SegmentToolbar"), source.indexOf("<SegmentPrompt"));
    const board = source.slice(source.indexOf("<ReferenceBoard"), source.indexOf("<SegmentReceipt"));
    expect(toolbar).toContain("<SegmentToolbar");
    expect(board).toContain("<ReferenceBoard");
    expect(toolbar).not.toContain("key={segment.id}");
    expect(board).not.toContain("key={segment.id}");
    expect(source).toContain('<div className="drama-sd" key={segment.id}>');
});
