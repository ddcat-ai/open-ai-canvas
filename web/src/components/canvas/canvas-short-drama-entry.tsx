import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Popover } from "antd";
import { Link } from "react-router";
import { AlignLeft, ArrowUp, Check, ChevronUp, Clapperboard, FolderKanban, Images, LayoutGrid, Palette, Pencil, Plus, Type, Upload, Workflow, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasCreateMenu, type CanvasCreateCommand } from "@/components/canvas/canvas-create-menu";
import type { CanvasShortDramaProgress, CanvasShortDramaStepId } from "@/lib/canvas/canvas-short-drama";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

import "./canvas-short-drama-entry.css";

export function CanvasLinkedProjectEmptyState({ projectName, hasChapter, onAddFirstChapter, onOpenAssets, onAddText }: { projectName: string; hasChapter: boolean; onAddFirstChapter: () => void; onOpenAssets: () => void; onAddText: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-4 pb-16 pt-20">
            <div className="pointer-events-auto w-full max-w-[440px] rounded-lg border p-3 shadow-sm backdrop-blur" data-canvas-no-zoom style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                <div className="flex items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><FolderKanban className="size-4" /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{projectName}</h2><p className="mt-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>项目画布为空</p></div></div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <button type="button" disabled={!hasChapter} onClick={onAddFirstChapter} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium disabled:opacity-35" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Plus className="size-3.5 shrink-0" /><span className="truncate">添加首章</span></button>
                    <button type="button" onClick={onOpenAssets} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Images className="size-3.5 shrink-0" /><span className="truncate">项目资产</span></button>
                    <button type="button" onClick={onAddText} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Type className="size-3.5 shrink-0" /><span className="truncate">新建文本</span></button>
                </div>
            </div>
        </div>
    );
}

/** 关联短剧的精修画布为空：从短剧投送内容开始精修，写回只经“采用到短剧”。 */
export function CanvasDramaEmptyState({ dramaName, studioPath, episodeLabel, onProjectEpisode, onAddText }: { dramaName: string; studioPath: string; episodeLabel?: string; onProjectEpisode?: () => void; onAddText: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    const actionStyle = { borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text };
    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-4 pb-16 pt-20">
            <div className="pointer-events-auto w-full max-w-[460px] rounded-lg border p-3 shadow-sm backdrop-blur" data-canvas-no-zoom style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                <div className="flex items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                        <Clapperboard className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold">{dramaName} · 精修画布</h2>
                        <p className="mt-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            从左侧短剧侧栏投送设定、剧情段或成片；精修后在节点工具栏点“采用到短剧”写回。
                        </p>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                    <button type="button" disabled={!onProjectEpisode} onClick={onProjectEpisode} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium disabled:opacity-35" style={actionStyle} title={onProjectEpisode ? `把${episodeLabel || "第一集"}的剧情段投送到画布` : "还没有可投送的剧情段"}>
                        <LayoutGrid className="size-3.5 shrink-0" />
                        <span className="truncate">投送{episodeLabel || "第一集"}</span>
                    </button>
                    <Link to={studioPath} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={actionStyle}>
                        <FolderKanban className="size-3.5 shrink-0" />
                        <span className="truncate">打开制作台</span>
                    </Link>
                    <button type="button" onClick={onAddText} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={actionStyle}>
                        <Type className="size-3.5 shrink-0" />
                        <span className="truncate">新建文本</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

const ENTRY_SUGGESTIONS = [
    "一个外卖员意外捡到会说话的猫",
    "都市甜宠：总裁和实习生的契约婚姻",
    "古风悬疑：雨夜古宅里的第三声钟响",
];

export function CanvasShortDramaEmptyState({ onCreatePipeline, onSubmitPrompt, onStartFreeform, onUpload, onAddText, onAddScript }: {
    onCreatePipeline: () => void;
    /** 空字符串表示只打开 Agent，不自动提交。 */
    onSubmitPrompt: (prompt: string) => void;
    onStartFreeform: () => void;
    onUpload: () => void;
    onAddText: () => void;
    onAddScript: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const [prompt, setPrompt] = useState("");
    const stageRef = useRef<HTMLDivElement>(null);
    const entryStyle = {
        "--canvas-entry-text": theme.node.text,
        "--canvas-entry-muted": theme.node.muted,
        "--canvas-entry-accent": theme.accent.primary,
        "--canvas-entry-on-accent": theme.accent.onPrimary,
        "--canvas-entry-surface": theme.spatial.elevated,
        "--canvas-entry-border": theme.toolbar.border,
        "--canvas-entry-shadow": theme.spatial.shadow,
    } as CSSProperties;
    const submit = () => {
        const value = prompt.trim();
        if (!value) return;
        onSubmitPrompt(value);
        setPrompt("");
    };
    useCanvasEntryClickRipple(stageRef);
    return (
        <div ref={stageRef} className="canvas-entry-stage" style={entryStyle}>
            <CanvasEntryAmbientRipple />
            <div className="canvas-entry-shell" data-canvas-no-zoom data-canvas-wheel-scroll>
                <span className="canvas-entry-eyebrow"><Clapperboard aria-hidden="true" />AI 短剧工作台</span>
                <h2 className="canvas-entry-title">让灵感，<strong>开始成片。</strong></h2>
                <p className="canvas-entry-subtitle">写下一句故事，Agent 帮你拆剧本、定角色、出分镜和视频。</p>
                <form
                    className="canvas-entry-composer"
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <textarea
                        value={prompt}
                        rows={2}
                        placeholder="描述你想拍的故事…"
                        aria-label="描述你想拍的故事"
                        onChange={(event) => setPrompt(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                submit();
                            }
                        }}
                    />
                    <div className="canvas-entry-composer-bar">
                        <button type="button" className="canvas-entry-ghost" onClick={onUpload}><Upload aria-hidden="true" />导入素材</button>
                        <span className="canvas-entry-hint">Enter 发送 · Shift+Enter 换行</span>
                        <button type="submit" className="canvas-entry-send" disabled={!prompt.trim()} aria-label="交给 Agent"><ArrowUp aria-hidden="true" /></button>
                    </div>
                </form>
                <div className="canvas-entry-suggestions" role="list" aria-label="灵感示例">
                    {ENTRY_SUGGESTIONS.map((item) => (
                        <button key={item} type="button" role="listitem" onClick={() => setPrompt(item)}>{item}</button>
                    ))}
                </div>
                <div className="canvas-entry-paths">
                    <button type="button" onClick={onCreatePipeline}><Workflow aria-hidden="true" /><span><strong>自己创作</strong><small>按短剧流程搭好节点</small></span></button>
                    <button type="button" onClick={onAddScript}><Clapperboard aria-hidden="true" /><span><strong>空白分镜</strong><small>直接写分镜表</small></span></button>
                    <button type="button" onClick={onAddText}><Type aria-hidden="true" /><span><strong>新建文本</strong><small>先记下想法</small></span></button>
                    <button type="button" onClick={onStartFreeform}><LayoutGrid aria-hidden="true" /><span><strong>空白画布</strong><small>不预设流程</small></span></button>
                </div>
            </div>
        </div>
    );
}

/** 背景常驻涟漪：只动 transform/opacity，走合成层，不触发布局。 */
function CanvasEntryAmbientRipple() {
    return (
        <div className="canvas-entry-ripple" aria-hidden="true">
            <span /><span /><span /><span />
        </div>
    );
}

/** 点击画布空白处时从点击位置扩散一圈涟漪；入口卡片内部的点击不触发。 */
function useCanvasEntryClickRipple(stageRef: RefObject<HTMLDivElement | null>) {
    useEffect(() => {
        const stage = stageRef.current;
        const viewport = stage?.closest<HTMLElement>("[data-canvas-viewport]") ?? stage?.parentElement;
        if (!stage || !viewport) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        const handle = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest(".canvas-entry-shell,[data-canvas-no-zoom]") || event.button !== 0) return;
            const rect = stage.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
            const wave = document.createElement("span");
            wave.className = "canvas-entry-click-ripple";
            wave.style.left = `${x}px`;
            wave.style.top = `${y}px`;
            stage.appendChild(wave);
            wave.addEventListener("animationend", () => wave.remove(), { once: true });
        };
        viewport.addEventListener("pointerdown", handle);
        return () => viewport.removeEventListener("pointerdown", handle);
    }, [stageRef]);
}

export function CanvasFreeformEmptyState({ commands }: { commands: CanvasCreateCommand[] }) {
    const theme = canvasThemes[useActiveTheme()];
    const [createOpen, setCreateOpen] = useState(false);
    const createCommands = commands.map((command) => ({
        ...command,
        onClick: () => {
            setCreateOpen(false);
            command.onClick();
        },
    }));
    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-4 pb-20 pt-24">
            <div className="pointer-events-auto flex min-h-[260px] w-full max-w-[520px] flex-col items-center justify-center rounded-2xl border border-dashed px-8 py-10 text-center backdrop-blur" data-canvas-no-zoom style={{ background: theme.node.fill, borderColor: theme.node.edge, boxShadow: theme.node.shadow, color: theme.node.text }}>
                <h2 className="text-base font-semibold">自由空白画布</h2>
                <p className="mt-1 text-xs" style={{ color: theme.node.muted }}>不预设流程，从任意一种素材开始创作。</p>
                <Popover
                    arrow={false}
                    open={createOpen}
                    onOpenChange={setCreateOpen}
                    placement="bottom"
                    trigger="click"
                    content={<div className="w-[420px] max-w-[calc(100vw-48px)] p-1" onWheel={(event) => event.stopPropagation()}><CanvasCreateMenu commands={createCommands} /></div>}
                >
                    <button
                        type="button"
                        aria-label="添加第一项"
                        className="mt-7 grid size-14 place-items-center rounded-full border outline-none transition-opacity duration-150 hover:opacity-85 focus-visible:ring-2 motion-reduce:transition-none"
                        style={{ background: theme.toolbar.panel, borderColor: theme.node.edge, color: theme.node.text, boxShadow: theme.node.shadow, "--tw-ring-color": theme.accent.primary } as CSSProperties}
                    >
                        <Plus className="size-6" />
                    </button>
                </Popover>
                <p className="mt-4 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>点击 + 添加文本、图片、视频、音频或导入素材</p>
            </div>
        </div>
    );
}

export function CanvasShortDramaGuide({ progress, collapsed, onToggle, onSkip, onStepClick }: {
    progress: CanvasShortDramaProgress;
    collapsed: boolean;
    onToggle: () => void;
    onSkip: () => void;
    onStepClick: (stepId: CanvasShortDramaStepId) => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    if (!progress.active || collapsed) return null;
    return (
        <div data-canvas-no-zoom className="absolute left-1/2 top-[var(--canvas-topbar-offset)] z-[var(--z-toolbar)] flex max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-1 rounded-lg border p-1 shadow-sm backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
            <div className="hide-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
                <div className="flex shrink-0 items-center px-[var(--space-1)]">
                    {progress.steps.map((step, index) => (
                        <Fragment key={step.id}>
                            {index ? (
                                <span
                                    aria-hidden
                                    className="shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none"
                                    style={{ width: "var(--flow-step-track-width)", height: "var(--flow-step-track-height)", background: step.status === "pending" ? theme.node.stroke : theme.accent.primary }}
                                />
                            ) : null}
                            <button
                                type="button"
                                aria-current={step.status === "current" ? "step" : undefined}
                                className="flex h-8 shrink-0 items-center gap-[var(--flow-step-gap)] rounded-md px-[var(--space-2)] outline-none transition-colors motion-reduce:transition-none hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-inset dark:hover:bg-white/10"
                                style={{ "--tw-ring-color": theme.accent.primary } as CSSProperties}
                                onClick={() => onStepClick(step.id)}
                            >
                                <span
                                    className="grid shrink-0 place-items-center rounded-full font-semibold transition-[color,background-color,border-color] duration-150 motion-reduce:transition-none"
                                    style={{
                                        width: step.status === "current" ? "var(--flow-step-node-current)" : "var(--flow-step-node)",
                                        height: step.status === "current" ? "var(--flow-step-node-current)" : "var(--flow-step-node)",
                                        background: step.status === "pending" ? "transparent" : theme.accent.primary,
                                        border: step.status === "pending" ? "var(--stroke-2) solid var(--cn-stroke)" : "none",
                                        color: step.status === "pending" ? theme.node.muted : theme.accent.onPrimary,
                                        boxShadow: step.status === "current" ? "var(--flow-step-current-glow)" : undefined,
                                        fontSize: step.status === "current" ? "var(--fs-body)" : "var(--fs-caption)",
                                    }}
                                >
                                    {step.status === "completed" ? <Check className="size-3.5" /> : index + 1}
                                </span>
                                <span
                                    className="whitespace-nowrap text-[var(--fs-caption)] font-semibold transition-colors duration-150 motion-reduce:transition-none"
                                    style={{ color: step.status === "current" ? theme.accent.primary : step.status === "completed" ? theme.node.text : theme.node.muted }}
                                >
                                    {step.label}
                                </span>
                            </button>
                        </Fragment>
                    ))}
                </div>
            </div>
            <span className="mx-1 h-4 w-px shrink-0" style={{ background: theme.toolbar.border }} />
            {!progress.completed ? <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[var(--fs-label)] outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.muted, "--tw-ring-color": theme.accent.primary } as CSSProperties} onClick={onSkip}><X className="size-3" />跳过导引</button> : null}
            <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.muted, "--tw-ring-color": theme.accent.primary } as CSSProperties} onClick={onToggle} aria-label="折叠短剧流程"><ChevronUp className="size-3.5" /></button>
        </div>
    );
}

export function CanvasStylePlaceholderNodeContent({ onChoose }: { onChoose: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    return (
        <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center" style={{ color: theme.node.text }}>
            <span className="grid size-10 place-items-center rounded-md" style={{ background: `${theme.accent.primary}16`, color: theme.accent.primary }}><Palette className="size-5" /></span>
            <div className="mt-3 text-sm font-semibold">项目画风</div>
            <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>待选择</div>
            <button type="button" className="mt-4 inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium outline-none transition hover:brightness-105 focus-visible:ring-2" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, "--tw-ring-color": theme.accent.primary } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onChoose(); }}><Palette className="size-3.5" />选择画风</button>
        </div>
    );
}

export function CanvasStoryInputNodeContent({ node, onEdit }: { node: CanvasNodeData; onEdit: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    const content = (node.metadata?.content || "").replace(/\s+/g, " ").trim();
    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><AlignLeft className="size-4" /></span><span className="truncate text-sm font-semibold">故事梗概</span></div>
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-hidden border-t pt-3 text-xs leading-6" style={{ borderColor: theme.node.stroke, color: content ? theme.node.muted : theme.node.placeholder }}>{content || "写下题材、角色、冲突和结局方向…"}</div>
            <button type="button" className="mt-3 inline-flex h-8 w-fit items-center gap-2 rounded-md px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.text, "--tw-ring-color": theme.accent.primary } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onEdit(); }}><Pencil className="size-3.5" />编辑故事</button>
        </div>
    );
}
