import { describe, expect, test } from "bun:test";

import { resolveToolbarEntries, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";

function createMainContext(canvasTool: "move" | "box-select" = "box-select"): ToolContext {
    return {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool,
        workspaceMode: "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        extractingVideoFrames: false,
        extractingAudio: false,
        trimmingVideo: false,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: {} as ToolbarHandlers,
    };
}

describe("canvas toolbar mode tools", () => {
    test("keeps grab and box-select as independent dock commands", () => {
        const entries = resolveToolbarEntries("main", createMainContext(), null);
        const move = entries.find((entry) => entry.kind === "command" && entry.id === "tool-move");
        const boxSelect = entries.find((entry) => entry.kind === "command" && entry.id === "tool-box-select");

        expect(move?.kind).toBe("command");
        expect(boxSelect?.kind).toBe("command");
        expect(entries.some((entry) => entry.id === "tool-canvas-mode")).toBe(false);
    });

    test("reflects the active canvas tool on its own command", () => {
        const moveEntries = resolveToolbarEntries("main", createMainContext("move"), null);
        const boxSelectEntries = resolveToolbarEntries("main", createMainContext("box-select"), null);
        const move = moveEntries.find((entry) => entry.kind === "command" && entry.id === "tool-move");
        const boxSelect = boxSelectEntries.find((entry) => entry.kind === "command" && entry.id === "tool-box-select");

        expect(move?.kind === "command" && move.active).toBe(true);
        expect(boxSelect?.kind === "command" && boxSelect.active).toBe(true);
    });
});
