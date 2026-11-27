import type { ReactNode } from "react";
import type { NodeToolbarGroup } from "@/lib/canvas/tool-registry/tool-definition";

export type NodeToolbarTool = {
    id: string;
    label: string;
    icon: ReactNode;
    group: NodeToolbarGroup;
    order: number;
    section?: string;
    description?: string;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
};

export type NodeToolbarMenuDefinition = { group: NodeToolbarGroup; label: string; icon: ReactNode };
export type NodeToolbarEntry = {
    id: string;
    label: string;
    icon: ReactNode;
    defaultPinned: boolean;
    iconOnly?: boolean;
} & ({ kind: "tool"; tool: NodeToolbarTool } | { kind: "menu"; tools: NodeToolbarTool[] });

export function buildNodeToolbarEntries(tools: NodeToolbarTool[], menus: NodeToolbarMenuDefinition[]): NodeToolbarEntry[] {
    const actions: NodeToolbarEntry[] = [...new Map(tools.map((tool) => [tool.id, tool])).values()]
        .sort((left, right) => left.order - right.order)
        .map((tool) => ({
            kind: "tool",
            id: tool.id,
            label: tool.label,
            icon: tool.icon,
            tool,
            defaultPinned: ["primary", "workspace", "utility"].includes(tool.group),
            iconOnly: tool.group === "utility",
        }));
    const categories: NodeToolbarEntry[] = menus.flatMap((menu) => {
        const children = tools.filter((tool) => tool.group === menu.group).sort((left, right) => left.order - right.order);
        return children.length ? [{ kind: "menu" as const, id: `menu:${menu.group}`, label: menu.label, icon: menu.icon, defaultPinned: true, tools: children }] : [];
    });
    return [...actions.filter((entry) => entry.kind === "tool" && entry.tool.group === "primary"), ...categories, ...actions.filter((entry) => entry.kind === "tool" && entry.tool.group !== "primary")];
}

export function resolvePinnedToolbarEntries(entries: NodeToolbarEntry[], pinnedEntryIds?: readonly string[]): NodeToolbarEntry[] {
    if (pinnedEntryIds === undefined) return entries.filter((entry) => entry.defaultPinned);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return [...new Set(pinnedEntryIds)].flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [entry] : [];
    });
}

export function visibleToolbarEntryCount(widths: readonly number[], availableWidth: number, reservedWidth: number, gap: number): number {
    let used = reservedWidth;
    let count = 0;
    for (const width of widths) {
        if (used + width + gap > availableWidth) break;
        used += width + gap;
        count += 1;
    }
    return count;
}
