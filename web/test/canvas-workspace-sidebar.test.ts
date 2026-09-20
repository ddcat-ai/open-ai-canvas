import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canvasDockStyle } from "../src/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "../src/lib/canvas-theme";

const component = (name: string) => readFileSync(new URL(`../src/components/canvas/${name}`, import.meta.url), "utf8");

test("canvas removes the standalone asset tray while retaining sidebar assets and zoom controls", () => {
    const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("CanvasAssetTray");
    expect(page).toContain("<CanvasZoomControls");
    expect(page).toContain("<CanvasWorkspacePanel");
    expect(component("canvas-workspace-panel.tsx")).toContain("<CanvasWorkspaceAssetPanel");
});

test("workspace keeps a permanent rail and independent task/history entries", () => {
    const source = component("canvas-workspace-panel.tsx");
    for (const label of ["主页", "节点", "资产", "任务", "历史"]) expect(source).toContain(label);
    expect(source).not.toContain('id: "tools"');
    expect(source).not.toContain("CanvasWorkspaceToolPanel");
    expect(source).not.toContain("onInsertTool");
    expect(source).toContain('aria-label="画布左侧菜单"');
    expect(source).toContain("aria-pressed={open && tab === id}");
    expect(source).toContain("<CanvasWorkspaceHistoryPanel");
    expect(source).toContain("<CanvasWorkspaceAssetPanel");
    expect(source).toContain("<AppDrawer");
});

test("asset panel uses scoped paginated data and existing insertion contract", () => {
    const source = component("canvas-workspace-asset-panel.tsx");
    expect(source).toContain('["canvas-workspace-assets", userId, category, kind, search]');
    expect(source).toContain("loadAssetLibraryPage");
    expect(source).toContain("assetPickerItemsToInsertPayloads");
    expect(source).toContain("query.fetchNextPage()");
    expect(source).toContain('role="alert"');
    expect(source).toContain("disabled={!insertable || Boolean(inserting)}");
});

test("image style and presets remain visible without the prompt template picker", () => {
    const source = component("canvas-node-prompt-panel.tsx");
    expect(source).toContain("canvas-node-tool-controls-inline");
    expect(source).toContain("<CanvasChooseImageStylePicker");
    expect(source).toContain("<CanvasNineGridPicker");
    expect(source).toContain('dense appearance="quiet"');
    expect(source).toContain('const showPromptTemplates = !simpleMode && mode !== "image"');
    expect(source).toContain("{showPromptTemplates ? <CanvasPresetPicker");
    expect(source).toContain("if (showPromptTemplates &&");
    expect(source).not.toContain('aria-label="生成工具"');
    expect(component("canvas-choose-image-style-picker.tsx")).toContain('resolvedLabel || "风格"');
});

test("history explicitly describes its bounded dataset", () => {
    expect(component("canvas-workspace-history-panel.tsx")).toContain("最近 30 条（含 Agent）");
});

test("cleared tool references do not fall back to the original generation prompt", () => {
    const source = readFileSync(new URL("../src/pages/canvas/use-canvas-render-model.ts", import.meta.url), "utf8");
    const toolReferences = source.split("const toolMentionReferencesByNodeId = useMemo")[1].split("const tokens =")[0];
    expect(toolReferences).toContain('node.metadata?.composerContent ?? node.metadata?.prompt ?? ""');
    expect(toolReferences).not.toContain("||");
});

test("workspace starts collapsed and keeps separated navigation and bottom toggle", () => {
    const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    expect(page).toContain("const [workspaceOpen, setWorkspaceOpen] = useState(false)");
    const panel = component("canvas-workspace-panel.tsx");
    expect(panel).toContain('className="canvas-workspace-rail-items"');
    expect(panel.indexOf("canvas-workspace-rail-toggle")).toBeGreaterThan(panel.indexOf("entries.map"));
    const css = component("canvas-workspace-panel.css");
    expect(css).toContain("gap: var(--space-3)");
    expect(css).toContain("margin-top: auto");
    expect(css).toContain("prefers-reduced-motion: reduce");
});

test("rail shares canvas dock colors rather than muted workspace navigation colors", () => {
    const panel = component("canvas-workspace-panel.tsx");
    expect(panel).toContain("canvasThemes[useActiveTheme()]");
    expect(panel).toContain('...canvasDockStyle(theme), boxShadow: "none"');
    const railCss = component("canvas-workspace-panel.css").split(".canvas-workspace-rail {")[1];
    expect(railCss).not.toContain("var(--muted-foreground)");
    expect(railCss).not.toContain("var(--workspace-navigation)");
    for (const token of ["--dock-command-hover", "--dock-command-active", "--dock-command-active-text", "--dock-tooltip-border"]) expect(railCss).toContain(`var(${token})`);
    for (const theme of Object.values(canvasThemes)) {
        const style = canvasDockStyle(theme);
        expect(style.background).toBe("var(--dock-surface)");
        expect(style.color).toBe(theme.toolbar.item);
    }
});
