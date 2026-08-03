import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Button, Checkbox, Modal, Space, Switch, Tag } from "antd";
import { Ellipsis, Settings2, Type } from "lucide-react";

import { FloatingDock, type FloatingDockEntry } from "@/components/ui/aceternity/floating-dock";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ImageQuickToolId } from "./canvas-image-toolbar-tools";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

export function ImageToolSettingsModal({ open, tools, selectedIds, showLabels, onToggle, onShowLabelsChange, onCancel, onSave }: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onShowLabelsChange: (visible: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const maxSelected = 7;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));
    const previewItems: FloatingDockEntry[] = [
        ...selectedTools.map((tool) => ({ id: tool.id, label: tool.title, displayLabel: tool.label, icon: tool.icon, active: tool.active, danger: tool.danger })),
        { id: "more", label: "自定义节点工具", displayLabel: "更多", icon: <Ellipsis className="size-4" /> },
    ];

    const updateSelectedTools = (values: ImageQuickToolId[]) => {
        const next = new Set(values);
        tools.forEach((tool) => {
            const visible = next.has(tool.id);
            if (selected.has(tool.id) !== visible) onToggle(tool.id, visible);
        });
    };

    return (
        <Modal
            title={<span className="inline-flex h-6 items-center gap-2 text-sm font-semibold"><Settings2 className="size-3.5" />自定义节点 Dock</span>}
            open={open}
            centered
            width={520}
            onCancel={onCancel}
            destroyOnHidden
            styles={{ body: { padding: 0 }, footer: { marginTop: 0 } }}
            footer={<Space size={6}><Button size="small" onClick={onCancel}>取消</Button><Button size="small" type="primary" onClick={onSave}>保存设置</Button></Space>}
        >
            <div className="flex h-11 items-center justify-between gap-3 border-b px-4" style={{ borderColor: theme.toolbar.border }}>
                <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><Type className="size-3.5" /></span>
                    <span className="flex h-5 items-center text-xs font-medium leading-none">显示功能名</span>
                </span>
                <Switch size="small" checked={showLabels} onChange={onShowLabelsChange} aria-label="显示节点 Dock 功能名" />
            </div>
            <div className="relative grid h-[92px] place-items-center overflow-hidden border-b" style={{ background: theme.canvas.background, borderColor: theme.toolbar.border }}>
                <div className="absolute inset-0 bg-[radial-gradient(currentColor_1px,transparent_1px)] opacity-15 [background-size:18px_18px]" />
                <div className="thin-scrollbar relative flex max-w-full overflow-x-auto px-4 py-3">
                    <FloatingDock items={previewItems} size="compact" showLabels={showLabels} ariaLabel="图片节点工具预览" className="shrink-0" style={canvasDockStyle(theme, theme.node.text)} />
                </div>
            </div>
            <div className="px-4 py-3">
                <div className="mb-2 flex h-5 items-center justify-between"><span className="text-xs font-semibold">快捷工具</span><Tag className="m-0 leading-5 text-[var(--fs-tiny)]" style={{ background: theme.accent.primarySoft, borderColor: theme.spatial.glowStrong, color: theme.accent.primary }}>{selectedTools.length}/{maxSelected}</Tag></div>
                <Checkbox.Group value={selectedIds} className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4" onChange={(values) => updateSelectedTools(values as ImageQuickToolId[])}>
                    {tools.map((tool) => (
                        <label key={tool.id} className="flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-[7px] border px-1.5 transition-colors" style={{ background: selected.has(tool.id) ? theme.accent.primarySoft : "transparent", borderColor: selected.has(tool.id) ? theme.accent.primary : theme.toolbar.border, color: selected.has(tool.id) ? theme.accent.primary : theme.node.text }}>
                            <Checkbox className="canvas-image-tool-checkbox shrink-0" style={{ "--tool-accent": theme.accent.primary } as CSSProperties} value={tool.id} disabled={!selected.has(tool.id) && selectedTools.length >= maxSelected} />
                            <span className="grid size-5 shrink-0 place-items-center rounded-[5px] [&_svg]:size-3" style={{ background: selected.has(tool.id) ? theme.accent.primary : theme.toolbar.itemHover, color: selected.has(tool.id) ? "#ffffff" : theme.node.muted }}>{tool.icon}</span>
                            <span className="min-w-0 truncate text-[var(--fs-tiny)] font-medium leading-none">{tool.label}</span>
                        </label>
                    ))}
                </Checkbox.Group>
            </div>
        </Modal>
    );
}
