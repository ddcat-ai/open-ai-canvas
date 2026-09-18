import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Clapperboard, CloudDownload, CloudUpload, CopyPlus, Focus, FolderKanban, Gauge, History, Home, LayoutGrid, LoaderCircle, Menu, Pencil, Plus, Redo2, Save, Search, Share2, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Tooltip } from "antd";

import { WorkspaceCreditGiftMark } from "@/components/layout/workspace-credit-gift-mark";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasShortDramaProgress } from "@/lib/canvas/canvas-short-drama";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasThemeStore } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasMediaPerformanceMode } from "@/types/canvas";
import { CanvasShortcutsModal } from "./canvas-shortcuts-modal";

type CanvasTopBarProps = {
    syncStatus?: ReactNode;
    versionsOpen: boolean;
    onToggleVersions: () => void;
    title: string;
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
    onSave: () => void | Promise<void>;
    onForceSave: () => void;
    onImportImage: () => void;
    onImportLibTV: () => void;
    onImportTapNow: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onShare: () => void;
    shortcutRequestNonce: number;
    mediaPerformanceMode: CanvasMediaPerformanceMode;
    onMediaPerformanceModeChange: (mode: CanvasMediaPerformanceMode) => void;
    onOpenSearch: () => void;
    projectContext?: CanvasContextSummary & { projectId: string; projectName: string };
    onEnterFocusMode: () => void;
    shortDramaGuide?: { progress: CanvasShortDramaProgress; collapsed: boolean; onToggle: () => void };
};

export function CanvasTopBar({
    syncStatus,
    versionsOpen,
    onToggleVersions,
    title,
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
    onSave,
    onForceSave,
    onImportImage,
    onImportLibTV,
    onImportTapNow,
    onUndo,
    onRedo,
    onShare,
    shortcutRequestNonce,
    mediaPerformanceMode,
    onMediaPerformanceModeChange,
    onOpenSearch,
    projectContext,
    onEnterFocusMode,
    shortDramaGuide,
}: CanvasTopBarProps) {
    const theme = canvasThemes[useCanvasThemeStore((state) => state.theme)];
    const dockStyle = canvasDockStyle(theme, theme.node.text);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing } = useWalletBalance(user?.id, creditsEnabled);
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);

    const handleShortDramaGuideToggle = () => {
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
            <div className="canvas-topbar pointer-events-none absolute inset-x-0 top-0 z-[var(--z-toolbar)] flex h-[var(--canvas-topbar-h)] items-center justify-between px-4 sm:px-5">
                <div className="canvas-topbar-cluster canvas-topbar-project-cluster pointer-events-auto flex min-w-0 items-center gap-2" style={dockStyle}>
                    <CanvasTopBarTooltip label="打开画布菜单">
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    { key: "home", icon: <Home className="size-4" />, label: <Link to="/">主页</Link> },
                                    { key: "projects", icon: <LayoutGrid className="size-4" />, label: <Link to="/canvas">画布</Link> },
                                    { type: "divider" },
                                    { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                    { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                    { key: "save", icon: <Save className="size-4" />, label: <MenuLabel text="保存" shortcut="⌘ S" />, onClick: () => void onSave() },
                                    { key: "force-save", icon: <CloudUpload className="size-4" />, label: "修复素材关联并保存", onClick: onForceSave },
                                    { type: "divider" },
                                    { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                    { key: "search", icon: <Search className="size-4" />, label: <MenuLabel text="搜索节点" shortcut="⌘ F" />, onClick: onOpenSearch },
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
                            <button type="button" className="canvas-topbar-action grid size-9 place-items-center rounded-full" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                                <Menu className="size-5" />
                            </button>
                        </Dropdown>
                    </CanvasTopBarTooltip>

                    <div ref={titleRef} className="canvas-topbar-title-block flex min-w-0 flex-auto flex-col items-start overflow-hidden">
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
                            <div className="canvas-topbar-title-row flex min-w-0 items-center gap-0.5">
                                <button type="button" className="min-w-0 flex-1 truncate text-left text-base font-semibold tracking-normal transition-opacity hover:opacity-75" onClick={onStartTitleEditing} title="点击修改画布名称">
                                    {title}
                                </button>
                                <CanvasTopBarTooltip label="重命名画布">
                                    <button
                                        type="button"
                                        className="canvas-topbar-action grid size-7 shrink-0 place-items-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
                                        style={{ color: theme.node.text }}
                                        onClick={onStartTitleEditing}
                                        aria-label="重命名画布"
                                    >
                                        <Pencil className="size-3.5" />
                                    </button>
                                </CanvasTopBarTooltip>
                            </div>
                        )}
                        {projectContext && !isTitleEditing ? (
                            <div className="canvas-topbar-project-context mt-0.5 flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
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
                    {syncStatus}
                </div>

                <div className="canvas-topbar-cluster canvas-topbar-tools-cluster pointer-events-auto flex items-center gap-1.5" style={dockStyle}>
                    <CanvasTopBarTooltip label="搜索画布节点">
                        <Button
                            type="text"
                            className="canvas-topbar-action !hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex"
                            style={{ color: theme.node.text }}
                            icon={<Search className="size-4" />}
                            onClick={onOpenSearch}
                            aria-label="搜索画布节点"
                        />
                    </CanvasTopBarTooltip>
                    <CanvasTopBarTooltip label="导入第三方画布">
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    { key: "libtv", icon: <CopyPlus className="size-4" />, label: "导入 LibTV 画布", onClick: onImportLibTV },
                                    { key: "tapnow", icon: <CloudDownload className="size-4" />, label: "导入 TapNow 画布", onClick: onImportTapNow },
                                ],
                            }}
                        >
                            <Button type="text" className="canvas-topbar-action canvas-topbar-import-button !h-10 !rounded-xl !px-2.5 !font-medium" style={{ color: theme.node.text }} icon={<CloudDownload className="size-4" />} aria-label="导入第三方画布">
                                <span className="hidden lg:inline">导入第三方画布</span>
                            </Button>
                        </Dropdown>
                    </CanvasTopBarTooltip>
                    <CanvasTopBarTooltip label="媒体性能模式">
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
                            <Button type="text" className="canvas-topbar-action !hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex" style={{ color: theme.node.text }} icon={<Gauge className="size-4" />} aria-label="媒体性能模式" />
                        </Dropdown>
                    </CanvasTopBarTooltip>
                    {user && creditsEnabled ? (
                        <CanvasTopBarTooltip label="打开积分中心">
                            <button
                                type="button"
                                className="canvas-topbar-action inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium tabular-nums"
                                style={{ color: theme.node.text }}
                                aria-label="打开积分中心"
                                onClick={() => openWorkspaceWallet()}
                            >
                                {refreshing && availableMicrocredits === null ? <LoaderCircle className="size-3.5 animate-spin opacity-60" style={{ color: theme.accent.primary }} /> : <WorkspaceCreditGiftMark className="is-compact" />}
                                <span>{availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}</span>
                            </button>
                        </CanvasTopBarTooltip>
                    ) : null}
                    <CanvasTopBarTooltip label="进入专注模式（Shift + Ctrl/Cmd + F）">
                        <Button type="text" className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Focus className="size-4" />} onClick={onEnterFocusMode} aria-label="进入专注模式" />
                    </CanvasTopBarTooltip>
                    {shortDramaGuide ? (
                        <CanvasTopBarTooltip label={shortDramaGuide.collapsed ? "展开短剧流程" : "收起短剧流程"}>
                            <Button
                                type="text"
                                className="canvas-topbar-action !h-10 !rounded-xl !px-2.5 !font-medium"
                                style={{ color: theme.node.text, background: shortDramaGuide.collapsed ? undefined : theme.toolbar.activeBg }}
                                icon={<Clapperboard className="size-4" />}
                                onClick={handleShortDramaGuideToggle}
                                aria-label="短剧流程"
                                aria-pressed={!shortDramaGuide.collapsed}
                            >
                                <span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>
                            </Button>
                        </CanvasTopBarTooltip>
                    ) : null}
                    <CanvasTopBarTooltip label="版本记录与本地草稿">
                        <Button
                            type="text"
                            className="canvas-topbar-action canvas-topbar-version-button !h-10 !rounded-xl !px-2.5 !font-medium"
                            style={{ color: theme.node.text, background: versionsOpen ? theme.toolbar.activeBg : undefined }}
                            icon={<History className="size-4" />}
                            aria-label="版本记录"
                            aria-pressed={versionsOpen}
                            onClick={onToggleVersions}
                        >
                            版本
                        </Button>
                    </CanvasTopBarTooltip>
                    <CanvasTopBarTooltip label="分享画布">
                        <Button type="text" className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Share2 className="size-4" />} onClick={onShare} aria-label="分享画布" />
                    </CanvasTopBarTooltip>
                </div>
            </div>
            <CanvasShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </>
    );
}

// 顶栏是 --z-toolbar 上的绝对定位浮层，会为子元素建立层叠上下文。行内绝对定位的提示
// 无论 z-index 多高都无法越过它，会被顶栏下方 --z-panel-floating 的生成任务面板盖住，
// 因此提示必须走 portal 的浮层层级。
function CanvasTopBarTooltip({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Tooltip title={label} placement="bottom">
            <span className="relative inline-flex">{children}</span>
        </Tooltip>
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
