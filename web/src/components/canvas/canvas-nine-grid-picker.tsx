import { useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { Grid3x3 } from "lucide-react";

import { TOOL_ICON_MAP } from "./canvas-resource-mention-textarea";
import { getNineGridMenuItems } from "./canvas-image-toolbar-tools";

function NineGridToolIcon({ iconName, className = "size-3.5 shrink-0" }: { iconName: string; className?: string }) {
    const Icon = TOOL_ICON_MAP[iconName] ?? Grid3x3;
    return <Icon className={className} />;
}

function buildNineGridMenuItems(onSelect: (toolId: number, label: string, icon: string) => void): MenuProps["items"] {
    const items = getNineGridMenuItems();
    const sections = new Map<string, typeof items>();
    for (const tool of items) {
        const list = sections.get(tool.section) || [];
        list.push(tool);
        sections.set(tool.section, list);
    }
    return [...sections].map(([section, entries]) => ({
        type: "group" as const,
        key: section,
        label: section,
        children: entries.map((tool) => ({
            key: tool.id,
            label: (
                <div>
                    <span className="inline-flex items-center gap-2">
                        <NineGridToolIcon iconName={tool.toolIconName} />
                        {tool.label}
                    </span>
                    {tool.description ? <div className="text-[var(--fs-tiny)] opacity-60">{tool.description}</div> : null}
                </div>
            ),
            onClick: () => {
                onSelect(tool.toolId, tool.label, tool.toolIconName);
            },
        })),
    }));
}

export function CanvasNineGridPicker({
    open,
    onOpenChange,
    icon = "Grid3x3",
    onSelect,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** 当前已选九宫格工具的 lucide 图标名，无选择时回退 Grid3x3。 */
    icon?: string;
    onSelect: (toolId: number, label: string, icon: string) => void;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const actualOpen = open ?? internalOpen;
    const setOpen = (next: boolean) => {
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    return (
        <Dropdown
            open={actualOpen}
            onOpenChange={setOpen}
            trigger={["click"]}
            menu={{
                items: buildNineGridMenuItems((toolId, label, toolIcon) => {
                    setOpen(false);
                    onSelect(toolId, label, toolIcon);
                }),
            }}
            popupRender={(menu) => (
                <div
                    className="canvas-node-toolbar-menu canvas-node-toolbar-menu-nine-grid"
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <div className="canvas-node-toolbar-menu-stack">{menu}</div>
                </div>
            )}
        >
            <button type="button" className="canvas-node-composer-header-action canvas-node-fixed-chip" aria-expanded={actualOpen} aria-haspopup="menu" onClick={() => setOpen(true)} onPointerDown={(event) => event.stopPropagation()}>
                <NineGridToolIcon iconName={icon} className="size-4 shrink-0" />
                <span className="truncate">预设</span>
            </button>
        </Dropdown>
    );
}
