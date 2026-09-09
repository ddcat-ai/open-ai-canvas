import { expect, test } from "bun:test";

import { readSourceText } from "./helpers/read-source";

test("canvas top bar uses the brand link and project switcher", async () => {
    const source = await readSourceText(new URL("../src/pages/canvas/canvas-project-top-bar.tsx", import.meta.url));

    expect(source).toContain('to="/"');
    expect(source).toContain('aria-label="返回首页"');
    expect(source).toContain("aria-label=\"切换画布\"");
    expect(source).toContain("useCanvasStore");
    expect(source).toContain("ProjectPreview");
    expect(source).toContain('placeholder="搜索画布"');
    expect(source).toContain('className="canvas-project-switcher-list"');
    expect(source).toContain('className="canvas-project-switcher-footer"');
    expect(source).toContain('className="canvas-project-switcher-create"');
    expect(source).toContain("<span>新建画布</span>");
    expect(source).toContain("items: projectMenuItems");
    expect(source).not.toContain('aria-label="打开画布菜单"');
    expect(source).not.toContain("删除当前画布");
});
