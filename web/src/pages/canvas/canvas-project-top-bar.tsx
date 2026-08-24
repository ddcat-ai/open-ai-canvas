import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Bot, Check, ChevronDown, Clapperboard, CloudDownload, Coins, CopyPlus, Focus, FolderKanban, Gauge, Home, LayoutGrid, LoaderCircle, Menu, Pencil, Plus, Redo2, Search, Settings2, Share2, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";

import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { LocaleToggle } from "@/components/layout/locale-switcher";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasShortDramaProgress } from "@/lib/canvas/canvas-short-drama";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatLocale } from "@/lib/format-locale";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasMediaPerformanceMode, CanvasWorkspaceMode } from "@/types/canvas";
import { useTranslation } from "react-i18next";
// 组件外的纯函数（canvasTitleInputSize）不能用 useTranslation，只能走这个非 React 出口
import { t } from "@/i18n";

type CanvasTopBarProps = {
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
    onImportImage: () => void;
    onImportLibTV: () => void;
    onImportTapNow: () => void;
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
    onImportLibTV,
    onImportTapNow,
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
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
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
            <div className="canvas-topbar pointer-events-none absolute left-0 right-0 top-0 z-[var(--z-toolbar)] flex h-[var(--canvas-topbar-h)] items-center justify-between px-4 sm:px-5">
                <div className="canvas-topbar-cluster canvas-topbar-project-cluster pointer-events-auto flex min-w-0 items-center gap-2" style={dockStyle}>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home className="size-4" />, label: <Link to="/">{t("canvas:home")}</Link> },
                                { key: "projects", icon: <LayoutGrid className="size-4" />, label: <Link to="/canvas">{t("canvas:canvas-3")}</Link> },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("canvas:new-canvas-2"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas:delete-current-canvas"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("canvas:import-assets"), onClick: onImportImage },
                                { key: "search", icon: <Search className="size-4" />, label: <MenuLabel text={t("canvas:search-nodes")} shortcut="⌘ K" />, onClick: onOpenSearch },
                                {
                                    key: "performance",
                                    icon: <Gauge className="size-4" />,
                                    label: t("canvas:media-performance"),
                                    children: [
                                        { key: "performance-auto", label: t("canvas:auto-performance"), onClick: () => onMediaPerformanceModeChange("auto") },
                                        { key: "performance-quality", label: t("canvas:quality-first"), onClick: () => onMediaPerformanceModeChange("quality") },
                                        { key: "performance-fast", label: t("canvas:performance-first"), onClick: () => onMediaPerformanceModeChange("performance") },
                                    ],
                                },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas:undo")} shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas:redo")} shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="canvas-topbar-action grid size-9 place-items-center rounded-full" style={{ color: theme.node.text }} aria-label={t("canvas:open-canvas-menu")}>
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

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
                                aria-label={t("canvas:canvas-name")}
                            />
                        ) : (
                            <div className="canvas-topbar-title-row flex min-w-0 items-center gap-0.5">
                                <button type="button" className="min-w-0 flex-1 truncate text-left text-base font-semibold tracking-normal transition-opacity hover:opacity-75" onClick={onStartTitleEditing} title={t("canvas:click-to-rename-canvas")}>
                                    {title}
                                </button>
                                <Tooltip title={t("canvas:rename-canvas")}>
                                    <button
                                        type="button"
                                        className="canvas-topbar-action grid size-7 shrink-0 place-items-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
                                        style={{ color: theme.node.text }}
                                        onClick={onStartTitleEditing}
                                        aria-label={t("canvas:rename-canvas")}
                                    >
                                        <Pencil className="size-3.5" />
                                    </button>
                                </Tooltip>
                            </div>
                        )}
                        {projectContext && !isTitleEditing ? (
                            <div className="canvas-topbar-project-context mt-0.5 flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                <Link to={`/projects/${projectContext.projectId}/overview`} className="inline-flex min-w-0 items-center gap-1 hover:underline" title={t("canvas:back-to-project-param", { projectName: projectContext.projectName })}>
                                    <FolderKanban className="size-3 shrink-0" />
                                    <span className="max-w-[120px] truncate">{projectContext.projectName}</span>
                                </Link>
                                <span aria-hidden>·</span>
                                <button type="button" className="min-w-0 truncate hover:underline" onClick={onOpenSearch} title={t("canvas:search-and-locate-chapters-or-shots")}>
                                    {projectContext.chapterLabel || t("canvas:param-nodes", { nodeCount: projectContext.nodeCount })}
                                    {projectContext.shotLabel ? ` · ${projectContext.shotLabel}` : ""}
                                    {projectContext.selectedCount ? t("canvas:param-selected", { selectedCount: projectContext.selectedCount }) : ""}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="canvas-topbar-cluster pointer-events-auto flex items-center gap-1.5" style={dockStyle}>
                    <LocaleToggle className="canvas-topbar-action inline-flex h-10 w-10 min-w-10 items-center justify-center rounded-xl" style={{ color: theme.node.text }} />
                    <Button
                        type="text"
                        className="canvas-topbar-action !hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex"
                        style={{ color: theme.node.text }}
                        icon={<Search className="size-4" />}
                        onClick={onOpenSearch}
                        aria-label={t("canvas:search-canvas-nodes")}
                        title={t("canvas:search-canvas-nodes")}
                    />
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: [
                                { key: "libtv", icon: <CopyPlus className="size-4" />, label: t("canvas:import-libtv-canvas"), onClick: onImportLibTV },
                                { key: "tapnow", icon: <CloudDownload className="size-4" />, label: t("canvas:import-tapnow-canvas"), onClick: onImportTapNow },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            className="canvas-topbar-action canvas-topbar-import-button !h-10 !rounded-xl !px-2.5 !font-medium"
                            style={{ color: theme.node.text }}
                            icon={<CloudDownload className="size-4" />}
                            aria-label={t("canvas:import-third-party-canvas-2")}
                            title={t("canvas:import-third-party-canvas-2")}
                        >
                            <span className="hidden lg:inline">{t("canvas:import-third-party-canvas-2")}</span>
                        </Button>
                    </Dropdown>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            selectable: true,
                            selectedKeys: [mediaPerformanceMode],
                            onClick: ({ key }) => onMediaPerformanceModeChange(key as CanvasMediaPerformanceMode),
                            items: [
                                { key: "auto", label: t("canvas:auto-performance") },
                                { key: "quality", label: t("canvas:quality-first") },
                                { key: "performance", label: t("canvas:performance-first") },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            className="canvas-topbar-action !hidden !h-10 !w-10 !min-w-10 !rounded-xl !p-0 lg:!inline-flex"
                            style={{ color: theme.node.text }}
                            icon={<Gauge className="size-4" />}
                            aria-label={t("canvas:media-performance-mode")}
                            title={t("canvas:media-performance-mode")}
                        />
                    </Dropdown>
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    {user && creditsEnabled ? (
                        <Link
                            to="/wallet"
                            className="canvas-topbar-action inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium tabular-nums"
                            style={{ color: theme.node.text }}
                            title={t("canvas:view-credit-details")}
                        >
                            {refreshing && availableMicrocredits === null ? <LoaderCircle className="size-3.5 animate-spin opacity-60" /> : <Coins className="size-3.5" />}
                            <span>{availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString(formatLocale(), { maximumFractionDigits: 3 })}</span>
                        </Link>
                    ) : null}
                    <Tooltip title={t("canvas:enter-focus-mode-f")}>
                        <Button
                            type="text"
                            className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Focus className="size-4" />}
                            onClick={onEnterFocusMode}
                            aria-label={t("canvas:enter-focus-mode")}
                        />
                    </Tooltip>
                    {shortDramaGuide ? (
                        <Tooltip title={shortDramaGuide.collapsed ? t("canvas:expand-drama-pipeline") : t("canvas:collapse-drama-pipeline")}>
                            <Button
                                type="text"
                                className="canvas-topbar-action !h-10 !rounded-xl !px-2.5 !font-medium"
                                style={{ color: theme.node.text, background: shortDramaGuide.collapsed ? undefined : theme.toolbar.activeBg }}
                                icon={<Clapperboard className="size-4" />}
                                onClick={handleShortDramaGuideToggle}
                                aria-label={t("canvas:drama-pipeline")}
                                aria-pressed={!shortDramaGuide.collapsed}
                            >
                                <span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>
                            </Button>
                        </Tooltip>
                    ) : null}
                    <Button
                        type="text"
                        className="canvas-topbar-action !h-10 !w-10 !min-w-10 !rounded-xl !p-0"
                        style={{ color: theme.node.text }}
                        icon={<Share2 className="size-4" />}
                        onClick={onShare}
                        aria-label={t("canvas:share-canvas")}
                        title={t("canvas:share-canvas")}
                    />
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="canvas-topbar-action !h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                        aria-pressed={agentOpen}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <Modal title={t("canvas:shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={[t("canvas:left-drag-on-empty-space"), t("canvas:space-left-middle-click")]} value={t("canvas:pan-view")} />
                    <Shortcut keys={[t("canvas:scroll-wheel")]} value={t("canvas:zoom-canvas")} />
                    <Shortcut keys={[t("canvas:zoom-slider")]} value={t("canvas:fine-tune-zoom")} />
                    <Shortcut keys={[t("canvas:shift-ctrl-cmd-left-drag")]} value={t("canvas:marquee-select-nodes")} />
                    <Shortcut keys={[t("canvas:toolbar-marquee"), t("canvas:left-drag")]} value={t("canvas:marquee-select-nodes-returns-to-move-and-select-when-done")} />
                    <Shortcut keys={["Shift / Ctrl / Cmd", t("canvas:click")]} value={t("canvas:add-to-selection")} />
                    <Shortcut keys={["Alt", t("canvas:click-marquee")]} value={t("canvas:remove-from-selection")} />
                    <Shortcut keys={["Ctrl / Cmd", "1 / 2 / 3"]} value={t("canvas:100-fit-all-fit-selection")} />
                    <Shortcut keys={["?"]} value={t("canvas:open-shortcuts")} />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "F"]} value={t("canvas:enter-exit-focus-mode")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas:select-all-nodes")} />
                    <Shortcut keys={["Ctrl / Cmd", "K"]} value={t("canvas:search-and-locate-nodes")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas:copy-paste-nodes-or-paste-clipboard-text-images")} />
                    <Shortcut keys={["Ctrl / Cmd", "S"]} value={t("canvas:save-canvas-layout-and-positions")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas:undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas:redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas:redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas:delete-selection")} />
                    <Shortcut keys={["Esc"]} value={t("canvas:clear-selection-and-close-overlays")} />
                    <Shortcut keys={[t("canvas:drag-in-images-videos-audio")]} value={t("canvas:upload-to-canvas")} />
                </div>
            </Modal>
        </>
    );
}

export function CanvasWorkspaceModeSwitch({ mode, onChange }: { mode: CanvasWorkspaceMode; onChange: (mode: CanvasWorkspaceMode) => void }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const simple = mode === "simple";
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", closeOnOutsidePress);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsidePress);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    const selectMode = (nextMode: CanvasWorkspaceMode) => {
        if (nextMode !== mode) onChange(nextMode);
        setOpen(false);
    };

    return (
        <div ref={rootRef} className="aceternity-mode-switch pointer-events-auto relative z-[var(--dock-z-popover)]">
            <motion.button
                type="button"
                whileHover={reducedMotion ? undefined : { y: -1 }}
                whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                transition={aceternityMotion.spring.dock}
                className="canvas-mode-switch-trigger flex h-10 min-w-28 items-center gap-2 rounded-xl border px-2.5 text-left outline-none backdrop-blur-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ ...canvasDockStyle(theme, theme.node.text), background: open ? "var(--dock-command-active)" : "var(--dock-surface)", outlineColor: theme.accent.primary }}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t("canvas:current-mode-click-to-switch", { mode: simple ? t("canvas:simple") : t("canvas:pro") })}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: theme.toolbar.itemHover, color: theme.accent.primary }}>
                    {simple ? <Sparkles className="size-3" /> : <Settings2 className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 whitespace-nowrap text-[var(--fs-caption)] font-semibold leading-none">{simple ? t("canvas:simple-mode") : t("canvas:pro-mode")}</span>
                <motion.span animate={{ rotate: open ? 180 : 0 }} transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock} className="grid size-4 place-items-center" style={{ color: theme.node.muted }}>
                    <ChevronDown className="size-3" />
                </motion.span>
            </motion.button>

            <div className="absolute bottom-11 right-0 w-72" style={{ maxWidth: "calc(100vw - var(--space-8))" }}>
                <AnimatePresence>
                    {open ? (
                        <motion.div
                            role="listbox"
                            aria-label={t("canvas:choose-canvas-work-mode")}
                            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.92 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.95 }}
                            transition={aceternityMotion.spring.panel}
                            className="canvas-mode-switch-menu aceternity-floating-panel w-full overflow-hidden rounded-[var(--r-lg)] border p-1.5 backdrop-blur-2xl"
                            style={{ ...canvasDockStyle(theme, theme.node.text), background: "var(--dock-surface)" }}
                        >
                            <ModeOption
                                active={simple}
                                motionEnabled={!reducedMotion}
                                icon={<Sparkles className="size-4" />}
                                title={t("canvas:simple-mode")}
                                description={t("canvas:keep-the-core-creation-path-with-fewer-parameters")}
                                theme={theme}
                                onClick={() => selectMode("simple")}
                            />
                            <ModeOption
                                active={!simple}
                                motionEnabled={!reducedMotion}
                                icon={<Settings2 className="size-4" />}
                                title={t("canvas:pro-mode")}
                                description={t("canvas:show-full-nodes-director-stage-and-generation-controls")}
                                theme={theme}
                                onClick={() => selectMode("professional")}
                            />
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
            className="canvas-mode-switch-option group flex min-h-14 w-full items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0"
            style={{ background: active ? theme.accent.primarySoft : "transparent", color: theme.node.text, outlineColor: theme.accent.primary }}
            onClick={onClick}
        >
            <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)] [&_svg]:size-3.5" style={{ background: theme.spatial.surface, color: active ? theme.accent.primary : theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[var(--fs-body)] font-semibold leading-none">{title}</span>
                <span className="mt-1.5 block text-[var(--fs-caption)] leading-5" style={{ color: theme.node.muted }}>
                    {description}
                </span>
            </span>
            <span className="grid size-5 shrink-0 place-items-center" style={{ color: theme.accent.primary, opacity: active ? 1 : 0 }}>
                <Check className="size-3.5" />
            </span>
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
    const visualLength = Array.from(value || t("canvas:canvas-name")).reduce((length, character) => length + (character.codePointAt(0)! > 0xff ? 2 : 1), 0);
    return Math.min(30, Math.max(5, visualLength));
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const { t } = useTranslation("canvas");
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const label = status.connected ? t("canvas:connected-to-local-codex") : status.enabled ? status.activity || t("canvas:connecting") : t("canvas:connecting-to-local-codex");
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button type="button" className="canvas-topbar-action flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium" style={{ background: "transparent", color: theme.node.text }} onClick={onClick} title={t("canvas:open-local-codex-panel")}>
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
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
