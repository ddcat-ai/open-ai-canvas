import { describe, expect, test } from "bun:test";

import { getToolbarTools, registerAddNodeMenuCommands, registerToolbarTools, getAddNodeMenuCommands } from "@/lib/canvas/tool-registry";

describe("画布工具注册表", () => {
    test("重复注册同一工具时保持单份定义", () => {
        const id = "test-hmr-toolbar-tool";
        const definition = { id, toolbar: "main" as const, label: "测试", category: "utility" as const, defaultOrder: 9999, icon: null as never, run: () => {} };
        registerToolbarTools([definition]);
        registerToolbarTools([{ ...definition, label: "更新后的测试" }]);
        const matches = getToolbarTools("main").filter((tool) => tool.id === id);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.label).toBe("更新后的测试");
    });

    test("重复注册同一添加节点命令时保持单份定义", () => {
        const id = "test-hmr-node-command";
        const command = { id, label: "测试节点", section: "node" as const, defaultOrder: 9999, icon: null as never, run: () => {} };
        registerAddNodeMenuCommands([command]);
        registerAddNodeMenuCommands([{ ...command, label: "更新后的测试节点" }]);
        const matches = getAddNodeMenuCommands().filter((item) => item.id === id);
        expect(matches).toHaveLength(1);
        expect(matches[0]?.label).toBe("更新后的测试节点");
    });
});
