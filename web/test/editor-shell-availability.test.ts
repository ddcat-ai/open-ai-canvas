import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("editor shell availability", () => {
    test("hides the project editor tab and overview step when the editor shell is disabled", () => {
        const detail = source("../src/pages/projects/detail.tsx");
        const overview = source("../src/pages/projects/detail/overview.tsx");

        expect(detail).toContain("state.pluginStates[EDITOR_SHELL_PLUGIN_ID]?.effectiveEnabled === true");
        expect(detail).toContain('views.filter((item) => item.key !== "editor" || editorEnabled)');
        expect(overview).toContain("state.pluginStates[EDITOR_SHELL_PLUGIN_ID]?.effectiveEnabled === true");
        expect(overview).toContain('.filter((step) => step.id !== "editor" || editorEnabled)');
    });

    test("waits for the plugin state before redirecting a direct editor URL", () => {
        const detail = source("../src/pages/projects/detail.tsx");
        const waiting = detail.indexOf('if (activeView === "editor" && !editorState)');
        const redirect = detail.indexOf('if (activeView === "editor" && !editorState?.effectiveEnabled) return <Navigate to={`/projects/${projectId}/overview`} replace />');

        expect(waiting).toBeGreaterThan(-1);
        expect(redirect).toBeGreaterThan(waiting);
        expect(detail.indexOf("<ProjectEditorView")).toBeGreaterThan(redirect);
    });

    test("renders editor slots only for effectively enabled plugins", () => {
        const editor = source("../src/pages/projects/detail/editor.tsx");
        const slotStack = editor.slice(editor.indexOf("function SlotStack"), editor.indexOf("function PanelTabs"));

        expect(slotStack).toContain("pluginStates[slot.pluginId]?.effectiveEnabled === true");
        expect(slotStack).toContain("const allowed = enabledSlots.filter(");
        expect(slotStack).toContain("const denied = enabledSlots.filter(");
    });
});
