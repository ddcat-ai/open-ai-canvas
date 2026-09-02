// 导出（editor-shell 预设插件贡献 export-renderer 插槽，M3.7）。
// 渲染计划与画布导出同源（buildTimelineRenderPlan 单一滤镜图计划，ADR-0003）；
// 执行走 ffmpeg.wasm 降级（timeline-export），M4 接入后端渲染任务后作为兜底路径保留。
// §3.1 引用契约：缺失 nodeId 源（节点已删除）按计划跳过，成片不因悬空引用失败。

import { useMemo, useState } from "react";
import { Download, Loader2, PackageOpen } from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { buildTimelineRenderPlan, type TimelineRenderSource } from "@/lib/timeline/timeline-to-ffmpeg";
import { exportTimelineToMp4, type TimelineExportProgress } from "@/lib/timeline/timeline-export";
import type { TimelineProject } from "@/types/timeline";

type ExportState = { phase: "idle" | "running" | "done" | "error"; percent: number; detail: string };

/** 从时间线 clip 收集渲染源（按 nodeId 关联；directMedia 提供本地媒体定位）。 */
function collectRenderSources(project: TimelineProject): TimelineRenderSource[] {
    const seen = new Set<string>();
    const sources: TimelineRenderSource[] = [];
    for (const clip of project.clips) {
        if (clip.kind !== "video" && clip.kind !== "image") continue;
        const direct = clip.directMedia;
        if (!direct) continue;
        if (seen.has(clip.nodeId)) continue;
        seen.add(clip.nodeId);
        sources.push({
            nodeId: clip.nodeId,
            fileName: `input-${sources.length}.mp4`,
            durationMs: clip.durationMs,
            storageKey: direct.storageKey,
            url: direct.url,
        });
    }
    return sources;
}

export function EditorExport() {
    const { project } = useEditorStoreContext();
    const [state, setState] = useState<ExportState>({ phase: "idle", percent: 0, detail: "" });

    const sources = useMemo(() => (project ? collectRenderSources(project) : []), [project]);
    const plan = useMemo(() => (project ? buildTimelineRenderPlan(project, sources) : null), [project, sources]);

    const exportMp4 = async () => {
        if (!project || sources.length === 0 || state.phase === "running") return;
        setState({ phase: "running", percent: 0, detail: "准备导出" });
        try {
            const blob = await exportTimelineToMp4(project, sources, {
                onProgress: (p: TimelineExportProgress) =>
                    setState({ phase: "running", percent: p.percent, detail: p.detail }),
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "timeline-export.mp4";
            a.click();
            URL.revokeObjectURL(url);
            setState({ phase: "done", percent: 100, detail: "导出完成，已开始下载" });
        } catch (error) {
            setState({ phase: "error", percent: 0, detail: error instanceof Error ? error.message : "导出失败" });
        }
    };

    if (!project) return null;

    return (
        <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-3 rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] p-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--director-dock-fg-strong)]">渲染计划</span>
                        <span className="text-[10px] text-[var(--director-dock-fg)]/60">{plan ? `${plan.steps.length} 步` : "—"}</span>
                    </div>
                    {plan && plan.steps.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                            {plan.steps.slice(0, 8).map((step, index) => (
                                <li key={index} className="flex items-center gap-2 text-[11px] text-[var(--director-dock-fg)]/70">
                                    <span className="shrink-0 rounded bg-[var(--director-dock-active-surface)] px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--director-dock-fg)]/80">
                                        {step.kind}
                                    </span>
                                    <span className="truncate">{step.description}</span>
                                </li>
                            ))}
                            {plan.steps.length > 8 && (
                                <li className="pt-0.5 text-[10px] text-[var(--director-dock-fg)]/50">…共 {plan.steps.length} 步</li>
                            )}
                        </ul>
                    ) : (
                        <p className="mt-2 text-[11px] text-[var(--director-dock-fg)]/55">时间线没有可渲染的视频片段。</p>
                    )}
                </div>

                <div className="mb-3 flex items-center justify-between rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-2.5 py-2 text-[11px] text-[var(--director-dock-fg)]/70">
                    <span className="flex items-center gap-1.5">
                        <PackageOpen className="size-3.5 text-[var(--director-dock-fg)]/60" />
                        渲染源
                    </span>
                    <span className="tabular-nums text-[var(--director-dock-fg)]/80">{sources.length} 个</span>
                </div>

                <button
                    type="button"
                    onClick={exportMp4}
                    disabled={sources.length === 0 || state.phase === "running"}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--director-accent)] px-2 py-1.5 text-xs font-medium text-[var(--director-on-accent)] hover:bg-[var(--director-accent-hover)] disabled:opacity-40"
                >
                    {state.phase === "running" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                        <Download className="size-3.5" />
                    )}
                    {state.phase === "running" ? "导出中…" : "导出 MP4（ffmpeg.wasm）"}
                </button>

                {state.phase === "running" && (
                    <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[10px] text-[var(--director-dock-fg)]/70">
                            <span>{state.detail}</span>
                            <span className="tabular-nums">{state.percent}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--director-control-hover)]">
                            <div
                                className="h-full rounded-full bg-[var(--director-accent)] transition-all"
                                style={{ width: `${state.percent}%` }}
                            />
                        </div>
                    </div>
                )}

                {state.phase === "done" && <p className="mt-2 text-[11px] text-[var(--director-success)]">{state.detail}</p>}
                {state.phase === "error" && <p className="mt-2 text-[11px] text-[var(--director-danger)]">{state.detail}</p>}

                <p className="mt-3 text-[11px] leading-relaxed text-[var(--director-dock-fg)]/55">
                    M3.7 使用 ffmpeg.wasm 本地降级导出；M4 接入后端渲染任务（异步任务客户端）后，同一渲染计划提交远端执行。
                </p>
                {sources.length === 0 && (
                    <p className="mt-1 text-[11px] text-[var(--director-dock-fg)]/55">悬空引用片段（节点已删除）按计划跳过，不影响其余片段导出。</p>
                )}
            </div>
        </div>
    );
}
