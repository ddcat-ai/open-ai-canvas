import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { Dropdown, Popover } from "antd";
import { AlignLeft, ArrowRight, Bot, Check, ChevronDown, ChevronUp, Clapperboard, FolderKanban, Images, MoreHorizontal, Palette, Pencil, Plus, Sparkles, Type, Upload, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasCreateMenu, type CanvasCreateCommand } from "@/components/canvas/canvas-create-menu";
import type { CanvasShortDramaProgress, CanvasShortDramaStepId } from "@/lib/canvas/canvas-short-drama";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasLinkedProjectEmptyState({ projectName, hasChapter, onAddFirstChapter, onOpenAssets, onAddText }: { projectName: string; hasChapter: boolean; onAddFirstChapter: () => void; onOpenAssets: () => void; onAddText: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-4 pb-16 pt-20">
            <div className="pointer-events-auto w-full max-w-[440px] rounded-lg border p-3 shadow-sm backdrop-blur" data-canvas-no-zoom style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                <div className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><FolderKanban className="size-4" /></span><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{projectName}</h2><p className="mt-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>项目画布为空</p></div></div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <button type="button" disabled={!hasChapter} onClick={onAddFirstChapter} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium disabled:opacity-35" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Plus className="size-3.5 shrink-0" /><span className="truncate">添加首章</span></button>
                    <button type="button" onClick={onOpenAssets} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Images className="size-3.5 shrink-0" /><span className="truncate">项目资产</span></button>
                    <button type="button" onClick={onAddText} className="flex h-9 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[var(--fs-label)] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}><Type className="size-3.5 shrink-0" /><span className="truncate">新建文本</span></button>
                </div>
            </div>
        </div>
    );
}

export function CanvasShortDramaEmptyState({ onCreatePipeline, onOpenAgent, onStartFreeform, onUpload, onAddText, onAddScript }: {
    onCreatePipeline: () => void;
    onOpenAgent: () => void;
    onStartFreeform: () => void;
    onUpload: () => void;
    onAddText: () => void;
    onAddScript: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const focusStyle = { "--tw-ring-color": theme.accent.primary } as CSSProperties;
    return (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center px-4 pb-20 pt-24">
            <div className="pointer-events-auto w-full max-w-[760px]" data-canvas-no-zoom>
                <div className="mb-4 text-center">
                    <h2 className="text-lg font-semibold">从哪里开始？</h2>
                    <p className="mt-1 text-sm" style={{ color: theme.node.muted }}>选择一条主路径，之后仍可随时切换。</p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    <PathCard
                        icon={<Clapperboard className="size-5" />}
                        title="自己创作"
                        description="搭好短剧骨架，再逐镜头编辑和生成。"
                        action="创建短剧流水线"
                        accent={theme.accent.primary}
                        theme={theme}
                        focusStyle={focusStyle}
                        onClick={onCreatePipeline}
                    />
                    <PathCard
                        icon={<Bot className="size-5" />}
                        title="交给 Agent"
                        description="用一句话描述题材、角色和核心冲突。"
                        action="一句话生成影视项目"
                        accent={theme.node.activeStroke}
                        theme={theme}
                        focusStyle={focusStyle}
                        onClick={onOpenAgent}
                    />
                    <PathCard
                        icon={<Plus className="size-5" />}
                        title="自由空白画布"
                        description="不预设流程，自由添加文本、图片、音频和视频。"
                        action="从空白画布开始"
                        accent={theme.node.muted}
                        theme={theme}
                        focusStyle={focusStyle}
                        onClick={onStartFreeform}
                    />
                </div>
                <div className="mt-3 flex justify-center">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "upload", icon: <Upload className="size-4" />, label: "导入素材", onClick: onUpload },
                                { key: "text", icon: <Type className="size-4" />, label: "新建文本", onClick: onAddText },
                                { key: "storyboard", icon: <Clapperboard className="size-4" />, label: "新建空白分镜", onClick: onAddScript },
                            ],
                        }}
                    >
                        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.muted, ...focusStyle }}>
                            <MoreHorizontal className="size-4" />其他起点<ChevronDown className="size-3" />
                        </button>
                    </Dropdown>
                </div>
            </div>
        </div>
    );
}

export function CanvasFreeformEmptyState({ commands }: { commands: CanvasCreateCommand[] }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
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
                        className="mt-7 grid size-14 place-items-center rounded-full border outline-none transition-transform hover:scale-105 focus-visible:ring-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
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

function PathCard({ icon, title, description, action, accent, theme, focusStyle, onClick }: {
    icon: ReactNode;
    title: string;
    description: string;
    action: string;
    accent: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    focusStyle: CSSProperties;
    onClick: () => void;
}) {
    return (
        <section className="flex min-h-[176px] flex-col rounded-lg border p-4 shadow-sm backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
            <span className="grid size-9 place-items-center rounded-md" style={{ background: `${accent}16`, color: accent }}>{icon}</span>
            <div className="mt-3 text-base font-semibold">{title}</div>
            <p className="mt-1 min-h-10 text-sm leading-5" style={{ color: theme.node.muted }}>{description}</p>
            <button type="button" className="mt-auto inline-flex h-9 w-full items-center justify-between rounded-md border px-3 text-sm font-semibold outline-none transition hover:brightness-105 focus-visible:ring-2" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text, ...focusStyle }} onClick={onClick}>
                <span>{action}</span><ArrowRight className="size-4" />
            </button>
        </section>
    );
}

export function CanvasShortDramaGuide({ progress, collapsed, onToggle, onSkip, onStepClick }: {
    progress: CanvasShortDramaProgress;
    collapsed: boolean;
    onToggle: () => void;
    onSkip: () => void;
    onStepClick: (stepId: CanvasShortDramaStepId) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
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
                                className="flex h-8 shrink-0 items-center gap-[var(--flow-step-gap)] rounded-md px-[var(--space-1-half)] outline-none transition-colors motion-reduce:transition-none hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-inset dark:hover:bg-white/10"
                                style={{ "--tw-ring-color": theme.accent.primary } as CSSProperties}
                                onClick={() => onStepClick(step.id)}
                            >
                                <span
                                    className="grid shrink-0 place-items-center rounded-full font-semibold transition-all duration-150 motion-reduce:transition-none"
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
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center" style={{ color: theme.node.text }}>
            <span className="grid size-10 place-items-center rounded-md" style={{ background: `${theme.accent.primary}16`, color: theme.accent.primary }}><Palette className="size-5" /></span>
            <div className="mt-3 text-sm font-semibold">项目画风</div>
            <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>待选择</div>
            <button type="button" className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium outline-none transition hover:brightness-105 focus-visible:ring-2" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, "--tw-ring-color": theme.accent.primary } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onChoose(); }}><Sparkles className="size-3.5" />选择画风</button>
        </div>
    );
}

export function CanvasStoryInputNodeContent({ node, onEdit }: { node: CanvasNodeData; onEdit: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const content = (node.metadata?.content || "").replace(/\s+/g, " ").trim();
    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}><AlignLeft className="size-4" /></span><span className="truncate text-sm font-semibold">故事梗概</span></div>
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-hidden border-t pt-3 text-xs leading-6" style={{ borderColor: theme.node.stroke, color: content ? theme.node.muted : theme.node.placeholder }}>{content || "写下题材、角色、冲突和结局方向…"}</div>
            <button type="button" className="mt-3 inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ color: theme.node.text, "--tw-ring-color": theme.accent.primary } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onEdit(); }}><Pencil className="size-3.5" />编辑故事</button>
        </div>
    );
}
