import { describe, expect, test } from "bun:test";

import { resolveAddNodeMenuCommands, type AddNodeMenuContext } from "../src/lib/canvas/tool-registry";

describe("普通画布添加菜单", () => {
    test("双击新建在未关联项目时也包含角色卡", () => {
        const commands = resolveAddNodeMenuCommands({
            workspaceMode: "professional",
            isProjectLinked: false,
            handlers: {} as AddNodeMenuContext["handlers"],
        });
        const character = commands.find((command) => command.id === "project-character");
        expect(character?.label).toBe("角色卡");
        expect(character?.section).toBe("node");
    });
});
