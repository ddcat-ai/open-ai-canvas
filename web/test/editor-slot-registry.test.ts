import { describe, expect, test } from "bun:test";

import {
    getEditorSlots,
    registerEditorSlot,
    unregisterEditorSlot,
} from "../src/lib/plugins/editor-slot-registry";

const render = () => null;

describe("editor slot registry", () => {
    test("registers a slot and returns it", () => {
        const unregister = registerEditorSlot({ pluginId: "editor-a", slot: "timeline-panel", render });
        const slots = getEditorSlots("timeline-panel");
        expect(slots).toHaveLength(1);
        expect(slots[0].pluginId).toBe("editor-a");
        unregister();
        expect(getEditorSlots("timeline-panel")).toHaveLength(0);
    });

    test("sorts by priority desc, then registration order asc", () => {
        const unregs = [
            registerEditorSlot({ pluginId: "a", slot: "preview-renderer", priority: 1, render }),
            registerEditorSlot({ pluginId: "b", slot: "preview-renderer", render }),
            registerEditorSlot({ pluginId: "c", slot: "preview-renderer", priority: 5, render }),
        ];
        const slots = getEditorSlots("preview-renderer");
        expect(slots.map((s) => s.pluginId)).toEqual(["c", "a", "b"]);
        unregs.forEach((u) => u());
    });

    test("re-registering same plugin+slot overrides (idempotent, HMR-safe)", () => {
        const unreg1 = registerEditorSlot({ pluginId: "x", slot: "inspector", render });
        const unreg2 = registerEditorSlot({ pluginId: "x", slot: "inspector", render });
        const slots = getEditorSlots("inspector");
        expect(slots).toHaveLength(1);
        expect(slots[0].pluginId).toBe("x");
        // 旧卸载函数不应误删新注册项
        unreg1();
        expect(getEditorSlots("inspector")).toHaveLength(1);
        unreg2();
        expect(getEditorSlots("inspector")).toHaveLength(0);
    });

    test("different plugins coexist in the same slot", () => {
        const unregs = [
            registerEditorSlot({ pluginId: "p1", slot: "subtitle-tool", render }),
            registerEditorSlot({ pluginId: "p2", slot: "subtitle-tool", render }),
        ];
        expect(getEditorSlots("subtitle-tool")).toHaveLength(2);
        unregisterEditorSlot("p1", "subtitle-tool");
        expect(getEditorSlots("subtitle-tool").map((s) => s.pluginId)).toEqual(["p2"]);
        unregs.forEach((u) => u());
    });

    test("unknown slot returns empty", () => {
        expect(getEditorSlots("export-renderer")).toHaveLength(0);
    });
});
