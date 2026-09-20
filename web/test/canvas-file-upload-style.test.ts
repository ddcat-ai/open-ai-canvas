import { expect, test } from "bun:test";

test("画布文件上传占位样式由组件独立加载", async () => {
    const [component, globals, styles] = await Promise.all([
        Bun.file(new URL("../src/components/canvas/canvas-file-upload-content.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/components/canvas/canvas-file-upload.css", import.meta.url)).text(),
    ]);

    expect(component).toContain('import "./canvas-file-upload.css";');
    expect(globals).not.toContain(".canvas-file-upload {");
    expect(globals).not.toContain("@keyframes canvas-file-upload-drift");
    expect(styles).toContain(".canvas-file-upload {");
    expect(styles).toContain(".canvas-file-upload-retry:focus-visible");
    expect(styles).toContain("@keyframes canvas-file-upload-drift");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
});

test("React Aria 浮层动画保留全局入口，但不再占用 globals.css", async () => {
    const [application, globals, styles] = await Promise.all([
        Bun.file(new URL("../src/application.tsx", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text(),
        Bun.file(new URL("../src/styles/shared/overlays.css", import.meta.url)).text(),
    ]);

    expect(application).toContain('import "./styles/shared/overlays.css";');
    expect(globals).not.toContain("@keyframes ra-pop-in");
    expect(globals).not.toContain(".ra-pop-in {");
    expect(styles).toContain("@keyframes ra-pop-in");
    expect(styles).toContain('.ra-pop-in[data-placement^="bottom"]');
    expect(styles).toContain("prefers-reduced-motion: reduce");
});
