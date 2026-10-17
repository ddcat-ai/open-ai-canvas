import { expect, test } from "bun:test";
import { getAddNodeMenuCommands, getToolbarTools, registerAddNodeMenuCommands, registerToolbarTools } from "@/lib/canvas/tool-registry/tool-registry";
import type { AddNodeMenuCommand, ToolDefinition } from "@/lib/canvas/tool-registry/tool-definition";

test("reloading a tool definition replaces its handler without duplicating toolbar entries", () => {
    const first: ToolDefinition = { id: "reload-probe", toolbar: "node-hover", category: "node-state", label: "old", icon: null, defaultVisible: true, defaultOrder: 1, run: () => {} };
    const updated = { ...first, label: "new", run: () => {} };
    registerToolbarTools([first]);
    registerToolbarTools([updated]);
    const matches = getToolbarTools("node-hover").filter((tool) => tool.id === first.id);
    expect(matches).toEqual([updated]);
    expect(matches[0].run).toBe(updated.run);
});

test("reloading add-node definitions keeps one current command", () => {
    const first: AddNodeMenuCommand = { id: "reload-node-probe", label: "old", icon: null, section: "node", defaultOrder: 1, run: () => {} };
    const updated = { ...first, label: "new" };
    registerAddNodeMenuCommands([first]);
    registerAddNodeMenuCommands([updated]);
    expect(getAddNodeMenuCommands().filter((command) => command.id === first.id)).toEqual([updated]);
});
