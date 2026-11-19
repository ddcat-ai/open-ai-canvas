import { expect, test } from "bun:test";
import { zhCN as canvasAZh } from "../src/i18n/messages/areas/canvasA/zh-CN";
import { zhCN as canvasCZh } from "../src/i18n/messages/areas/canvasC/zh-CN";
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
    for (const label of ["节点", "素材库", "任务", "历史"]) expect(source).toContain(label);
    expect(source).not.toContain("主页");
    expect(source).not.toContain('id: "tools"');
    expect(source).not.toContain("CanvasWorkspaceToolPanel");
    expect(source).not.toContain("onInsertTool");
    expect(source).toContain('aria-label="画布左侧菜单"');
    expect(source).toContain("aria-pressed={open && tab === id}");
    expect(source).toContain("<CanvasWorkspaceHistoryPanel");
    expect(source).toContain("<CanvasWorkspaceAssetPanel");
    expect(source).toContain('aria-label="画布工作区"');
    expect(source).not.toContain("<AppDrawer");
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
    expect(source).toMatch(/\{showPromptTemplates\s*\?\s*\(?\s*<CanvasPresetPicker/);
    expect(source).toContain("if (showPromptTemplates &&");
    expect(source).not.toContain('aria-label="生成工具"');
    expect(component("canvas-choose-image-style-picker.tsx")).toContain('resolvedLabel || t("canvasA.toolPicker.style.short")');
    expect(canvasAZh.toolPicker.style.short).toBe("风格");
});

test("history explicitly describes its bounded dataset", () => {
    expect(component("canvas-workspace-history-panel.tsx")).toContain('t("canvasC.workspaceHistory.title")');
    expect(canvasCZh.workspaceHistory.title).toContain("最近 30 条（含 Agent）");
});

test("cleared tool references do not fall back to the original generation prompt", () => {
    const source = readFileSync(new URL("../src/pages/canvas/use-canvas-render-model.ts", import.meta.url), "utf8");
    const toolReferences = source.split("const toolMentionReferencesByNodeId = useMemo")[1].split("const tokens =")[0];
    expect(toolReferences).toContain("const text = nodeGenerationPrompt(node);");
    expect(toolReferences).not.toContain("||");
});

test("workspace starts collapsed and keeps separated navigation and bottom toggle", () => {
    const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    expect(page).toContain("const [workspaceOpen, setWorkspaceOpen] = useState(false)");
    const panel = component("canvas-workspace-panel.tsx");
    expect(panel).toContain('className="canvas-workspace-rail-items"');
    expect(panel.indexOf("canvas-workspace-rail-toggle")).toBeGreaterThan(panel.indexOf("entries.map"));
    const css = component("canvas-workspace-panel.css");
    expect(css).toContain("gap: var(--space-1)");
    expect(css).toContain("margin-top: auto");
    expect(css).toContain("prefers-reduced-motion: reduce");
});

test("rail inherits canvas dock colors from the workspace shell", () => {
    const panel = component("canvas-workspace-panel.tsx");
    expect(panel).toContain("canvasThemes[useActiveTheme()]");
    expect(panel).toContain("...canvasDockStyle(theme)");
    expect(panel).toContain("background: undefined");
    expect(panel).not.toContain('boxShadow: "none"');
    const railCss = component("canvas-workspace-panel.css").split(".canvas-workspace-rail {")[1];
    expect(railCss).not.toContain("var(--muted-foreground)");
    expect(railCss).not.toContain("var(--workspace-navigation)");
    for (const token of ["--dock-command-hover", "--dock-command-active", "--dock-command-active-text"]) expect(railCss).toContain(`var(${token})`);
    for (const theme of Object.values(canvasThemes)) {
        const style = canvasDockStyle(theme);
        expect(style.background).toBe("var(--dock-surface)");
        expect(style.color).toBe(theme.toolbar.item);
    }
});

test("project heading, rail and inline panel stay in one corner without intercepting the rest of the canvas", () => {
    const page = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
    const panel = component("canvas-workspace-panel.tsx");
    const styles = component("canvas-workspace-panel.css");
    expect(page).toContain("<CanvasViewport");
    expect(page).not.toContain("canvas-workspace-backdrop");
    expect(page).toContain("canvas-main-with-workspace");
    expect(styles).toContain(".canvas-main-with-workspace .canvas-editor-shell {\n    z-index: 0;");
    expect(page).toContain("heading={projectHeading}");
    expect(page).toContain("projectHeading={dramaCanvas ? projectHeading : undefined}");
    expect(panel).toMatch(/\{heading\}\s*<div\s+className="canvas-workspace-shell"/);
    expect(panel).not.toContain("screens.lg");
    expect(styles).toMatch(/\.canvas-workspace-corner \{[^}]*pointer-events: none;/);
    expect(styles).toMatch(/\.canvas-workspace-corner:not\(\.is-expanded\) \{[^}]*row-gap: var\(--space-2\);/);
    expect(styles).toMatch(/\.canvas-workspace-corner > .canvas-topbar-project-cluster,\s*\.canvas-workspace-shell \{[^}]*pointer-events: auto;/);
    expect(styles).toContain("width: min(100%, var(--canvas-workspace-open-width))");
    expect(styles).toContain("left: var(--canvas-workspace-inset)");
    expect(styles).toContain(".canvas-workspace-zoom-controls");
    expect(styles).toContain(".canvas-main-with-workspace > .canvas-project-sidebar {\n        margin-left: var(--space-16);");
    expect(styles).not.toContain(".canvas-main-with-workspace .canvas-topbar {");
    expect(panel.match(/className="canvas-workspace-rail-divider"/g)).toHaveLength(1);
    expect(panel).not.toContain("<strong>工作区</strong>");
    const dividerCss = styles.split(".canvas-workspace-rail-divider {")[1]?.split("}")[0] ?? "";
    expect(dividerCss).toContain("width: var(--space-6)");
    expect(dividerCss).toContain("background: color-mix(in srgb, currentColor 12%, transparent)");
    expect(styles).not.toContain("border-right: 1px solid var(--dock-border)");
    expect(styles).not.toContain('canvas-workspace-rail-button[aria-pressed="true"]::before');
    expect(styles).toContain("background: var(--canvas-workspace-material);");
    expect(styles).toContain(".canvas-workspace-panel > :is(header, .border-b) {\n    border-bottom: 0 !important;");
    expect(page).toContain('workspaceOpen ? "canvas-workspace-expanded" : ""');
});
