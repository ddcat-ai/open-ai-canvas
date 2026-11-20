import { useRef, useState } from "react";
import type { MenuProps } from "antd";
import { ChevronDown, Grid3x3, Ratio } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CanvasAnchoredDropdown as Dropdown } from "./canvas-anchored-dropdown";
import { getNineGridMenuItems } from "./canvas-image-toolbar-tools";
import { TOOL_ICON_MAP } from "./canvas-mention-chips";
import { CanvasToolMenuOption, CanvasToolMenuSurface } from "./canvas-tool-menu";

export function CanvasNineGridPicker({
    open,
    onOpenChange,
    icon = "Grid3x3",
    selectedToolId,
    toolbar = false,
    iconOnly = false,
    onSelect,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    icon?: string;
    selectedToolId?: number;
    toolbar?: boolean;
    iconOnly?: boolean;
    onSelect: (toolId: number, label: string, icon: string) => void;
}) {
    const { t } = useTranslation();
    const [internalOpen, setInternalOpen] = useState(false);
    const [inspectedId, setInspectedId] = useState<number>();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const actualOpen = open ?? internalOpen;
    const setOpen = (next: boolean) => {
        if (!next) setInspectedId(undefined);
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    const presets = getNineGridMenuItems();
    const featured = presets.find((preset) => preset.id === "character_four_view")!;
    const inspected = presets.find((preset) => preset.toolId === (inspectedId ?? selectedToolId)) ?? featured;
    const sections = new Map<string, typeof presets>();
    for (const preset of presets) {
        const group = sections.get(preset.sectionKey);
        if (group) group.push(preset);
        else sections.set(preset.sectionKey, [preset]);
    }
    const items: MenuProps["items"] = [...sections].map(([key, entries]) => ({
        type: "group",
        key,
        className: `canvas-preset-${key}`,
        label: entries[0].section,
        children: entries.map((preset) => {
            const Icon = TOOL_ICON_MAP[preset.toolIconName];
            const selected = selectedToolId === preset.toolId;
            return {
                key: preset.id,
                "data-preset-id": preset.toolId,
                role: toolbar ? "menuitem" : "menuitemradio",
                "aria-checked": toolbar ? undefined : selected,
                "aria-description": preset.description,
                onMouseEnter: () => setInspectedId(preset.toolId),
                onFocus: () => setInspectedId(preset.toolId),
                label: <CanvasToolMenuOption icon={<Icon />} label={preset.label} featured={preset === featured} checked={selected} />,
                onClick: () => {
                    onSelect(preset.toolId, preset.label, preset.toolIconName);
                },
            };
        }),
    }));
    const label = t(toolbar ? "canvasB.nineGrid.creativePresets" : "canvasB.nineGrid.presets");
    const TriggerIcon = TOOL_ICON_MAP[icon] ?? Grid3x3;
    return (
        <Dropdown
            open={actualOpen}
            onOpenChange={setOpen}
            trigger={["click"]}
            placement={toolbar ? "top" : "bottomLeft"}
            autoFocus
            align={{ offset: [0, 0], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
            styles={{ root: { padding: 8 } }}
            menu={{ items, selectable: false, "aria-label": label }}
            popupRender={(menu) => (
                <div
                    ref={panelRef}
                    className="canvas-node-toolbar-menu"
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDownCapture={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            triggerRef.current?.focus();
                            setOpen(false);
                        }
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <CanvasToolMenuSurface
                        className="canvas-image-preset-menu"
                        description={inspected.description}
                        detailEnd={
                            <span className="canvas-image-preset-ratio">
                                <Ratio />
                                {inspected.ratio === "original" ? t("canvasB.nineGrid.sourceRatio") : inspected.ratio}
                            </span>
                        }
                    >
                        {menu}
                    </CanvasToolMenuSurface>
                </div>
            )}
        >
            <button
                ref={triggerRef}
                type="button"
                className={
                    toolbar ? `aceternity-dock-command is-labeled inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[var(--dock-item-radius)] ${iconOnly ? "w-8" : "px-2"}` : "canvas-node-composer-header-action canvas-node-fixed-chip"
                }
                aria-label={label}
                title={label}
                aria-expanded={actualOpen}
                aria-haspopup="menu"
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && actualOpen) {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpen(false);
                        return;
                    }
                    if (event.key !== "ArrowDown") return;
                    event.preventDefault();
                    if (actualOpen) panelRef.current?.querySelector<HTMLElement>("[data-preset-id]")?.focus();
                    else setOpen(true);
                }}
            >
                <TriggerIcon aria-hidden className={toolbar ? "size-3.5" : "size-4 shrink-0"} />
                {!iconOnly ? <span className={toolbar ? "text-[var(--fs-label)] font-medium" : "truncate"}>{label}</span> : null}
                {toolbar && !iconOnly ? <ChevronDown aria-hidden className="canvas-node-toolbar-chevron size-3" /> : null}
            </button>
        </Dropdown>
    );
}
