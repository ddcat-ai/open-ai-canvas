import { describe, expect, test } from "bun:test";

import {
    getEditorSlots,
    registerEditorSlot,
    unregisterEditorSlot,
} from "../src/lib/plugins/editor-slot-registry";

const render = () => null;

// 真实插件 editor-shell 会在被导入时占满全部 EditorSlotKind，而它是否已被导入取决于测试执行顺序。
// 这里只断言本文件自己注册的 pluginId，使结果不再受其它测试文件的副作用影响。
const ownSlots = (slot: Parameters<typeof getEditorSlots>[0]) =>
    getEditorSlots(slot)
        .filter((item) => ["editor-a", "a", "b", "c", "x", "p1", "p2"].includes(item.pluginId))
        .map((item) => item.pluginId);

describe("editor slot registry", () => {
    test("registers a slot and returns it", () => {
        const unregister = registerEditorSlot({ pluginId: "editor-a", slot: "timeline-panel", render });
        expect(ownSlots("timeline-panel")).toEqual(["editor-a"]);
        unregister();
        expect(ownSlots("timeline-panel")).toEqual([]);
    });

    test("sorts by priority desc, then registration order asc", () => {
        const unregs = [
            registerEditorSlot({ pluginId: "a", slot: "preview-renderer", priority: 1, render }),
            registerEditorSlot({ pluginId: "b", slot: "preview-renderer", render }),
            registerEditorSlot({ pluginId: "c", slot: "preview-renderer", priority: 5, render }),
        ];
        expect(ownSlots("preview-renderer")).toEqual(["c", "a", "b"]);
        unregs.forEach((u) => u());
    });

    test("re-registering same plugin+slot overrides (idempotent, HMR-safe)", () => {
        const unreg1 = registerEditorSlot({ pluginId: "x", slot: "inspector", render });
        const unreg2 = registerEditorSlot({ pluginId: "x", slot: "inspector", render });
        expect(ownSlots("inspector")).toEqual(["x"]);
        // 旧卸载函数不应误删新注册项
        unreg1();
        expect(ownSlots("inspector")).toEqual(["x"]);
        unreg2();
        expect(ownSlots("inspector")).toEqual([]);
    });

    test("different plugins coexist in the same slot", () => {
        const unregs = [
            registerEditorSlot({ pluginId: "p1", slot: "subtitle-tool", render }),
            registerEditorSlot({ pluginId: "p2", slot: "subtitle-tool", render }),
        ];
        expect(ownSlots("subtitle-tool")).toEqual(["p1", "p2"]);
        unregisterEditorSlot("p1", "subtitle-tool");
        expect(ownSlots("subtitle-tool")).toEqual(["p2"]);
        unregs.forEach((u) => u());
    });

    test("slots this file never registered into stay untouched", () => {
        // 真实插件会占用 export-renderer，因此断言「本文件没有向未注册的插槽留下贡献」。
        expect(ownSlots("export-renderer")).toEqual([]);
    });
});