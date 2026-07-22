import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Button, Checkbox, Modal, Space, Tag } from "antd";
import { Ellipsis, Image as ImageIcon, Settings2 } from "lucide-react";

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

export function ImageToolSettingsModal({ open, tools, selectedIds, onToggle, onCancel, onSave }: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const maxSelected = 7;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));
    const previewItems: FloatingDockEntry[] = [
        ...selectedTools.map((tool) => ({ id: tool.id, label: tool.title, icon: tool.icon, active: tool.active, danger: tool.danger })),
        { id: "more", label: "自定义节点工具", icon: <Ellipsis className="size-4" /> },
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
            title={<span className="inline-flex items-center gap-2 text-sm"><Settings2 className="size-3.5" />自定义节点 Dock</span>}
            open={open}
            centered
            width={560}
            onCancel={onCancel}
            destroyOnHidden
            styles={{ header: { marginBottom: 10 }, footer: { marginTop: 12 } }}
            footer={<Space size={6}><Button size="small" onClick={onCancel}>取消</Button><Button size="small" type="primary" onClick={onSave}>保存</Button></Space>}
        >
            <p className="mb-3 text-xs" style={{ color: theme.node.muted }}>选择悬浮图片节点时直接出现的高频工具，其余能力仍可从节点菜单进入。</p>
            <div className="relative mb-4 grid min-h-40 place-items-center overflow-hidden rounded-[18px] border" style={{ background: theme.canvas.background, borderColor: theme.toolbar.border }}>
                <div className="absolute inset-0 bg-[radial-gradient(currentColor_1px,transparent_1px)] opacity-15 [background-size:18px_18px]" />
                <div className="relative flex flex-col items-center gap-3">
                    <FloatingDock items={previewItems} size="compact" ariaLabel="图片节点工具预览" style={canvasDockStyle(theme, theme.node.text)} />
                    <div className="grid h-20 w-36 place-items-center rounded-[14px] border" style={{ background: theme.node.fill, borderColor: theme.node.stroke, boxShadow: `0 14px 38px ${theme.spatial.shadow}` }}>
                        <span className="flex flex-col items-center gap-1.5 text-[10px]" style={{ color: theme.node.muted }}><ImageIcon className="size-5" />图片节点</span>
                    </div>
                </div>
            </div>
            <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-semibold">快捷工具</span><Tag className="m-0 text-[10px]" style={{ background: theme.accent.primarySoft, borderColor: theme.spatial.glowStrong, color: theme.accent.primary }}>{selectedTools.length}/{maxSelected}</Tag></div>
            <Checkbox.Group value={selectedIds} className="grid w-full grid-cols-2 gap-1.5 md:grid-cols-4" onChange={(values) => updateSelectedTools(values as ImageQuickToolId[])}>
                {tools.map((tool) => (
                    <label key={tool.id} className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2 transition-colors" style={{ background: selected.has(tool.id) ? theme.accent.primarySoft : "transparent", borderColor: selected.has(tool.id) ? theme.accent.primary : theme.toolbar.border, color: selected.has(tool.id) ? theme.accent.primary : theme.node.text }}>
                        <Checkbox className="canvas-image-tool-checkbox" style={{ "--tool-accent": theme.accent.primary } as CSSProperties} value={tool.id} disabled={!selected.has(tool.id) && selectedTools.length >= maxSelected} />
                        <span className="grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5" style={{ background: selected.has(tool.id) ? theme.accent.primary : theme.toolbar.itemHover, color: selected.has(tool.id) ? "#ffffff" : theme.node.muted }}>{tool.icon}</span>
                        <span className="min-w-0 truncate text-[10px] font-semibold">{tool.label}</span>
                    </label>
                ))}
            </Checkbox.Group>
        </Modal>
    );
}
