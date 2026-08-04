import { Modal, Switch } from "antd";
import { GripVertical, RotateCcw } from "lucide-react";
import { Reorder, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultToolbarPrefs, getToolbarTools, persistToolbarPrefs, readToolbarPrefs, type ToolbarId, type ToolbarPrefs, type ToolContext, type ToolDefinition } from "@/lib/canvas/tool-registry";
import { useThemeStore } from "@/stores/use-theme-store";

type ToolbarSettingsModalProps = {
    open: boolean;
    onClose: () => void;
    toolbar: ToolbarId;
};

/** 设置面板用的最小化上下文——仅用于解析工具的 label/icon */
const settingsMockContext: ToolContext = {
    selectedCount: 0,
    selectedNodeTypes: new Set(),
    selectedVideoCount: 0,
    canvasTool: "move",
    workspaceMode: "professional",
    isProjectLinked: false,
    canUndo: false,
    canRedo: false,
    extractingVideoFrame: false,
    mergingVideos: false,
    addPanelOpen: false,
    appearancePanelOpen: false,
    settingsPanelOpen: false,
    handlers: {} as ToolContext["handlers"],
};

type SettingsItem = {
    id: string;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
};

export function ToolbarSettingsModal({ open, onClose, toolbar }: ToolbarSettingsModalProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const [items, setItems] = useState<SettingsItem[]>([]);
    const [toolbarId, setToolbarId] = useState<ToolbarId>(toolbar);

    // 当 modal 打开或 toolbar 变化时，加载工具列表与偏好
    useEffect(() => {
        if (!open) return;
        setToolbarId(toolbar);
        const tools = getToolbarTools(toolbar);
        const prefs = readToolbarPrefs(toolbar) ?? defaultToolbarPrefs(toolbar);
        const hiddenSet = new Set(prefs.hidden);
        const orderIndex = new Map(prefs.order.map((id, index) => [id, index]));
        const sorted = [...tools].sort((a, b) => {
            const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
            const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
            if (ai !== bi) return ai - bi;
            return a.defaultOrder - b.defaultOrder;
        });
        setItems(sorted.map((tool) => ({
            id: tool.id,
            label: resolveLabel(tool, settingsMockContext),
            icon: resolveIcon(tool, settingsMockContext),
            visible: !hiddenSet.has(tool.id),
        })));
    }, [open, toolbar]);

    const handleReorder = (newOrder: SettingsItem[]) => {
        setItems(newOrder);
        persistCurrent(newOrder);
    };

    const handleToggleVisible = (id: string, visible: boolean) => {
        setItems((prev) => {
            const next = prev.map((item) => item.id === id ? { ...item, visible } : item);
            persistCurrent(next);
            return next;
        });
    };

    const handleReset = () => {
        const defaults = defaultToolbarPrefs(toolbarId);
        const tools = getToolbarTools(toolbarId);
        const hiddenSet = new Set(defaults.hidden);
        setItems(tools.map((tool) => ({
            id: tool.id,
            label: resolveLabel(tool, settingsMockContext),
            icon: resolveIcon(tool, settingsMockContext),
            visible: !hiddenSet.has(tool.id),
        })));
        persistToolbarPrefs(toolbarId, defaults);
    };

    const persistCurrent = (currentItems: SettingsItem[]) => {
        const prefs: ToolbarPrefs = {
            order: currentItems.map((item) => item.id),
            hidden: currentItems.filter((item) => !item.visible).map((item) => item.id),
        };
        persistToolbarPrefs(toolbarId, prefs);
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            title="工具栏设置"
            width={360}
            centered
            destroyOnClose
            styles={{ body: { padding: 0 } }}
        >
            <div className="flex items-center justify-between px-4 pb-2 pt-1">
                <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>拖拽排序 · 开关控制显隐</span>
                <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1 rounded-[var(--dock-item-radius)] px-2 py-1 text-[var(--fs-tiny)] font-semibold transition-colors hover:bg-current/5"
                    style={{ color: theme.node.muted }}
                >
                    <RotateCcw className="size-3" />
                    恢复默认
                </button>
            </div>
            <Reorder.Group
                axis="y"
                values={items}
                onReorder={handleReorder}
                className="thin-scrollbar max-h-[60vh] space-y-1 overflow-y-auto px-3 pb-4"
            >
                {items.map((item) => (
                    <Reorder.Item
                        key={item.id}
                        value={item}
                        initial={false}
                        animate={reducedMotion ? undefined : { opacity: 1 }}
                        dragTransition={reducedMotion ? undefined : { bounceStiffness: 600, bounceDamping: 40 }}
                        className="flex items-center gap-2 rounded-[var(--dock-item-radius)] border px-2.5 py-2"
                        style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.text }}
                    >
                        <GripVertical className="size-4 shrink-0 cursor-grab opacity-40 active:cursor-grabbing" />
                        <span className="grid size-5 shrink-0 place-items-center opacity-70 [&_svg]:size-3.5">{item.icon}</span>
                        <span className="min-w-0 flex-1 truncate text-[var(--fs-label)] font-medium">{item.label}</span>
                        <Switch size="small" checked={item.visible} onChange={(checked) => handleToggleVisible(item.id, checked)} />
                    </Reorder.Item>
                ))}
            </Reorder.Group>
        </Modal>
    );
}

function resolveLabel(tool: ToolDefinition, ctx: ToolContext): string {
    return typeof tool.label === "function" ? tool.label(ctx) : tool.label;
}

function resolveIcon(tool: ToolDefinition, ctx: ToolContext): React.ReactNode {
    return typeof tool.icon === "function" ? tool.icon(ctx) : tool.icon;
}
