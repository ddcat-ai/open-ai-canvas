import { expect, test } from "bun:test";

test("滚动条样式按复用边界拆分，并保持全局入口可用", async () => {
    const [application, globals, shared, creation, creationWorkspace, editor, editorShell] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/scrollbars.css", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/create/creation-scrollbars.css", import.meta.url)).text(),
        Bun.file(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/lib/plugins/builtin/editor/editor-shell.css", import.meta.url)).text(),
        Bun.file(new URL("../src/lib/plugins/builtin/editor/editor-shell.tsx", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/scrollbars.css";');
    expect(globals).not.toContain(".hide-scrollbar {");
    expect(globals).not.toContain(".thin-scrollbar {");
    expect(globals).not.toContain(".storyboard-scrollbar {");
    expect(globals).not.toContain(".hover-scrollbar {");
    expect(globals).not.toContain(".creation-scrollbar {");
    expect(globals).not.toContain(".director-scroll {");
    expect(globals).not.toContain(".editor-slider {");

    expect(shared).toContain(".hide-scrollbar {");
    expect(shared).toContain(".thin-scrollbar {");
    expect(shared).toContain(".storyboard-scrollbar {");
    expect(shared).toContain(".hover-scrollbar {");
    expect(creation).toContain(".creation-scrollbar {");
    expect(creationWorkspace).toContain('import "./creation-scrollbars.css";');
    expect(editor).toContain(".director-scroll {");
    expect(editor).toContain(".editor-slider {");
    expect(editorShell).toContain('import "./editor-shell.css";');
});
