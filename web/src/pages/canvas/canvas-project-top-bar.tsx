import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Bot, Check, ChevronDown, Clapperboard, Coins, Focus, FolderKanban, Gauge, Home, LayoutGrid, LoaderCircle, Menu, Pencil, Plus, Redo2, Search, Settings2, Share2, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";

import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { aceternityMotion } from "@/lib/aceternity-motion";
import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasShortDramaProgress } from "@/lib/canvas/canvas-short-drama";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasMediaPerformanceMode, CanvasWorkspaceMode } from "@/types/canvas";

type CanvasTopBarProps = {
    title: string;
    workspaceMode: CanvasWorkspaceMode;
    onWorkspaceModeChange: (mode: CanvasWorkspaceMode) => void;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onShare: () => void;
    agentOpen: boolean;
    compactAgentStatus?: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
    shortcutRequestNonce: number;
    mediaPerformanceMode: CanvasMediaPerformanceMode;
    onMediaPerformanceModeChange: (mode: CanvasMediaPerformanceMode) => void;
    onOpenSearch: () => void;
    projectContext?: CanvasContextSummary & { projectId: string; projectName: string };
    onEnterFocusMode: () => void;
    shortDramaGuide?: { progress: CanvasShortDramaProgress; collapsed: boolean; onToggle: () => void };
};

export function CanvasTopBar({
    title,
    workspaceMode,
    onWorkspaceModeChange,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    onShare,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
    shortcutRequestNonce,
    mediaPerformanceMode,
    onMediaPerformanceModeChange,
    onOpenSearch,
    projectContext,
    onEnterFocusMode,
    shortDramaGuide,
}: CanvasTopBarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing } = useWalletBalance(user?.id, creditsEnabled);
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [workspaceModeOpen, setWorkspaceModeOpen] = useState(false);

    const handleWorkspaceModeOpenChange = (next: boolean) => {
        // 模式开关下拉向下展开，会覆盖展开中的短剧流程条，打开时先收起流程条避免重叠。
        if (next && shortDramaGuide && !shortDramaGuide.collapsed) shortDramaGuide.onToggle();
        setWorkspaceModeOpen(next);
    };

    const handleShortDramaGuideToggle = () => {
        // 展开流程条会与模式开关下拉在顶部中心重叠，展开前先关闭模式开关。
        if (shortDramaGuide?.collapsed) setWorkspaceModeOpen(false);
        shortDramaGuide?.onToggle();
    };

    useEffect(() => {
        if (shortcutRequestNonce > 0) setShortcutsOpen(true);
    }, [shortcutRequestNonce]);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-[var(--z-toolbar)] flex h-[var(--canvas-topbar-h)] items-center justify-between px-[var(--canvas-inset-x)]">
                <div className="pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: <Link to="/">主页</Link> },
                                { key: "projects", icon: <LayoutGrid className="size-4" />, label: <Link to="/canvas">画布</Link> },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { key: "search", icon: <Search className="size-4" />, label: <MenuLabel text="搜索节点" shortcut="⌘ K" />, onClick: onOpenSearch },
                                {
                                    key: "performance",
                                    icon: <Gauge className="size-4" />,
                                    label: "媒体性能",
                                    children: [
                                        { key: "performance-auto", label: "自动性能", onClick: () => onMediaPerformanceModeChange("auto") },
                                        { key: "performance-quality", label: "画质优先", onClick: () => onMediaPerformanceModeChange("quality") },
                                        { key: "performance-fast", label: "性能优先", onClick: () => onMediaPerformanceModeChange("performance") },
                                    ],
                                },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 flex-col items-start">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                size={canvasTitleInputSize(titleDraft)}
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="h-8 w-auto min-w-12 max-w-[min(280px,42vw)] appearance-none border-0 bg-transparent p-0 text-left text-base font-semibold tracking-normal outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                                style={{ color: theme.node.text, caretColor: theme.accent.primary, border: 0, boxShadow: "none", outline: "none" }}
                                aria-label="画布名称"
                            />
                        ) : (
                            <div className="flex min-w-0 items-center gap-0.5">
                                <button type="button" className="max-w-[280px] truncate text-left text-base font-semibold tracking-normal transition-opacity hover:opacity-75" onClick={onStartTitleEditing} title="点击修改画布名称">
                                    {title}
                                </button>
                                <Tooltip title="重命名画布">
                                    <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md opacity-60 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={onStartTitleEditing} aria-label="重命名画布">
                                        <Pencil className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </div>
                        )}
                        {projectContext && !isTitleEditing ? (
                            <div className="mt-0.5 flex max-w-[360px] items-center gap-1.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                <Link to={`/projects/${projectContext.projectId}/overview`} className="inline-flex min-w-0 items-center gap-1 hover:underline" title={`返回项目：${projectContext.projectName}`}>
                                    <FolderKanban className="size-3 shrink-0" />
                                    <span className="max-w-[120px] truncate">{projectContext.projectName}</span>
                                </Link>
                                <span aria-hidden>·</span>
                                <button type="button" className="min-w-0 truncate hover:underline" onClick={onOpenSearch} title="搜索并定位章节或镜头">
                                    {projectContext.chapterLabel || `${projectContext.nodeCount} 个节点`}
                                    {projectContext.shotLabel ? ` · ${projectContext.shotLabel}` : ""}
                                    {projectContext.selectedCount ? ` · 已选 ${projectContext.selectedCount}` : ""}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <CanvasWorkspaceModeSwitch mode={workspaceMode} onChange={onWorkspaceModeChange} open={workspaceModeOpen} onOpenChange={handleWorkspaceModeOpenChange} />

                <div className="pointer-events-auto flex items-center gap-1.5">
                    <Button type="text" className="!hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex" style={{ color: theme.node.text }} icon={<Search className="size-4" />} onClick={onOpenSearch} aria-label="搜索画布节点" title="搜索画布节点" />
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            selectable: true,
                            selectedKeys: [mediaPerformanceMode],
                            onClick: ({ key }) => onMediaPerformanceModeChange(key as CanvasMediaPerformanceMode),
                            items: [
                                { key: "auto", label: "自动性能" },
                                { key: "quality", label: "画质优先" },
                                { key: "performance", label: "性能优先" },
                            ],
                        }}
                    >
                        <Button type="text" className="!hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex" style={{ color: theme.node.text }} icon={<Gauge className="size-4" />} aria-label="媒体性能模式" title="媒体性能模式" />
                    </Dropdown>
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    {user && creditsEnabled ? (
                        <Link
                            to="/wallet"
                            className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium tabular-nums transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: theme.node.text }}
                            title="查看积分明细"
                        >
                            {refreshing && availableMicrocredits === null ? <LoaderCircle className="size-3.5 animate-spin opacity-60" /> : <Coins className="size-3.5" />}
                            <span>{availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}</span>
                        </Link>
                    ) : null}
                    <Tooltip title="进入专注模式（⇧⌘F）">
                        <Button
                            type="text"
                            className="!h-10 !w-10 !min-w-10 !rounded-xl !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Focus className="size-4" />}
                            onClick={onEnterFocusMode}
                            aria-label="进入专注模式"
                        />
                    </Tooltip>
                    {shortDramaGuide ? (
                        <Tooltip title={shortDramaGuide.collapsed ? "展开短剧流程" : "收起短剧流程"}>
                            <Button
                                type="text"
                                className="!h-10 !rounded-xl !px-2.5 !font-medium"
                                style={{ color: theme.node.text, background: shortDramaGuide.collapsed ? undefined : theme.toolbar.activeBg }}
                                icon={<Clapperboard className="size-4" />}
                                onClick={handleShortDramaGuideToggle}
                                aria-label="短剧流程"
                            >
                                <span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>
                            </Button>
                        </Tooltip>
                    ) : null}
                    <Button type="text" className="!h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Share2 className="size-4" />} onClick={onShare} aria-label="分享画布" title="分享画布" />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["空白处左键拖动", "空格 + 左键 / 中键"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Shift / Ctrl / Cmd + 左键拖动"]} value="框选多个节点" />
                    <Shortcut keys={["工具栏「框选」", "左键拖动"]} value="框选多个节点，完成后自动回到「移动与选择」" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Alt", "点击 / 框选"]} value="移除选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "1 / 2 / 3"]} value="100% / 适应全部 / 适应选择" />
                    <Shortcut keys={["?"]} value="打开快捷键" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "F"]} value="进入 / 退出专注模式" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "K"]} value="搜索并定位节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "S"]} value="保存画布布局和位置" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入图片/视频/音频"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function CanvasWorkspaceModeSwitch({ mode, onChange, open, onOpenChange }: { mode: CanvasWorkspaceMode; onChange: (mode: CanvasWorkspaceMode) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const simple = mode === "simple";
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) onOpenChange(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onOpenChange(false);
        };
        document.addEventListener("pointerdown", closeOnOutsidePress);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsidePress);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [open, onOpenChange]);

    const selectMode = (nextMode: CanvasWorkspaceMode) => {
        if (nextMode !== mode) onChange(nextMode);
        onOpenChange(false);
    };

    return (
        <div ref={rootRef} className="aceternity-mode-switch pointer-events-auto absolute left-1/2 top-2 z-[var(--dock-z-popover)] -translate-x-1/2">
            <motion.button
                type="button"
                whileHover={reducedMotion ? undefined : { y: -1 }}
                whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                transition={aceternityMotion.spring.dock}
                className="flex h-9 min-w-28 items-center gap-2 rounded-full px-2.5 text-left outline-none backdrop-blur-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ background: open ? theme.spatial.surface : theme.spatial.elevated, color: theme.node.text, boxShadow: "var(--workspace-overlay-shadow)", outlineColor: theme.accent.primary }}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`当前为${simple ? "简洁" : "专业"}模式，点击切换`}
                onClick={() => onOpenChange(!open)}
            >
                <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: theme.toolbar.itemHover, color: theme.accent.primary }}>
                    {simple ? <Sparkles className="size-3" /> : <Settings2 className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 whitespace-nowrap text-[var(--fs-caption)] font-semibold leading-none">{simple ? "简洁模式" : "专业模式"}</span>
                <motion.span animate={{ rotate: open ? 180 : 0 }} transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock} className="grid size-4 place-items-center" style={{ color: theme.node.muted }}>
                    <ChevronDown className="size-3" />
                </motion.span>
            </motion.button>

            <div className="absolute left-1/2 top-11 w-72 -translate-x-1/2" style={{ maxWidth: "calc(100vw - var(--space-8))" }}>
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            role="listbox"
                            aria-label="选择画布工作模式"
                            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.92 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.95 }}
                            transition={aceternityMotion.spring.panel}
                            className="aceternity-floating-panel w-full overflow-hidden rounded-[var(--r-lg)] p-1.5 backdrop-blur-2xl"
                            style={{ background: theme.spatial.elevated, color: theme.node.text, boxShadow: "var(--workspace-overlay-shadow)" }}
                        >
                            <ModeOption active={simple} motionEnabled={!reducedMotion} icon={<Sparkles className="size-4" />} title="简洁模式" description="保留核心创作路径，降低参数密度" theme={theme} onClick={() => selectMode("simple")} />
                            <ModeOption active={!simple} motionEnabled={!reducedMotion} icon={<Settings2 className="size-4" />} title="专业模式" description="显示完整节点、导演台与生成控制" theme={theme} onClick={() => selectMode("professional")} />
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
}

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

function ModeOption({ active, motionEnabled, icon, title, description, theme, onClick }: { active: boolean; motionEnabled: boolean; icon: ReactNode; title: string; description: string; theme: CanvasTheme; onClick: () => void }) {
    return (
        <motion.button
            type="button"
            role="option"
            aria-selected={active}
            whileTap={motionEnabled ? { scale: 0.98 } : undefined}
            transition={aceternityMotion.spring.dock}
            className="group flex min-h-14 w-full items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-left outline-none transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 dark:hover:bg-white/8"
            style={{ background: active ? theme.accent.primarySoft : "transparent", color: theme.node.text, outlineColor: theme.accent.primary }}
            onClick={onClick}
        >
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)] [&_svg]:size-3.5" style={{ background: theme.spatial.surface, color: active ? theme.accent.primary : theme.node.muted }}>{icon}</span>
            <span className="min-w-0 flex-1"><span className="block text-[var(--fs-body)] font-semibold leading-none">{title}</span><span className="mt-1.5 block text-[var(--fs-caption)] leading-5" style={{ color: theme.node.muted }}>{description}</span></span>
            <span className="grid size-5 shrink-0 place-items-center" style={{ color: theme.accent.primary, opacity: active ? 1 : 0 }}><Check className="size-3.5" /></span>
        </motion.button>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function canvasTitleInputSize(value: string) {
    const visualLength = Array.from(value || "画布名称").reduce((length, character) => length + (character.codePointAt(0)! > 0xff ? 2 : 1), 0);
    return Math.min(30, Math.max(5, visualLength));
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const label = status.connected ? "已连接到本地 Codex" : status.enabled ? status.activity || "连接中" : "正在连接本地 Codex";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-85" style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }} onClick={onClick} title="打开本地 Codex 面板">
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[180px] truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]" style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}>
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
