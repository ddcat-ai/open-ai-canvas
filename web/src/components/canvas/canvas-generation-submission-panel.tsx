import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Eye } from "lucide-react";
import { App, Checkbox, Tag } from "antd";

import { buildGenerationSubmissionSnapshot, canvasReferenceRoleLabel } from "@/lib/canvas/canvas-generation-submission";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasGenerationMode, CanvasNodeData, GenerationSubmissionSnapshot } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    mode: CanvasGenerationMode;
    userPrompt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    model?: string;
    interfaceType?: string;
    size?: string;
    seconds?: string;
    vquality?: string;
    onExcludedChange: (nodeId: string, excludedIds: string[]) => void;
    /** 紧凑模式：默认折叠，只显示路径徽章 */
    compact?: boolean;
};

export function CanvasGenerationSubmissionPanel({
    node,
    mode,
    userPrompt,
    nodes,
    connections,
    model,
    interfaceType,
    size,
    seconds,
    vquality,
    onExcludedChange,
    compact = true,
}: Props) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(!compact);
    const [showLast, setShowLast] = useState(false);
    const excluded = node.metadata?.excludedReferenceNodeIds || [];

    const snapshot = useMemo(
        () =>
            buildGenerationSubmissionSnapshot({
                nodeId: node.id,
                mode,
                userPrompt,
                nodes,
                connections,
                excludedReferenceNodeIds: excluded,
                model,
                interfaceType,
                size,
                seconds,
                vquality,
            }),
        [connections, excluded, interfaceType, mode, model, node.id, nodes, seconds, size, userPrompt, vquality],
    );

    const toggleIncluded = (referenceId: string, included: boolean) => {
        const key = referenceId;
        const next = new Set(excluded);
        if (included) next.delete(key);
        else next.add(key);
        onExcludedChange(node.id, Array.from(next));
    };

    const copyEffective = async () => {
        try {
            await navigator.clipboard.writeText(snapshot.effectivePrompt || "");
            message.success("已复制将发送的提示词");
        } catch {
            message.error("复制失败");
        }
    };

    const includedCount = snapshot.references.filter((item) => item.included).length;
    const totalCount = snapshot.references.length;
    const lastSnapshot = node.metadata?.submissionSnapshot;

    return (
        <div className="overflow-hidden rounded-md border text-[10px]" style={{ borderColor: theme.toolbar.border, background: theme.spatial.surface, color: theme.node.text }}>
            <button
                type="button"
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:brightness-110"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
            >
                <Eye className="size-3 shrink-0 opacity-70" />
                <Tag className="!m-0 !border-0 !px-1.5 !text-[9px] !leading-4" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                    {snapshot.pathLabel}
                </Tag>
                <span className="min-w-0 flex-1 truncate opacity-70">
                    参考 {includedCount}/{totalCount}
                    {snapshot.mentions.length ? ` · @${snapshot.mentions.length}` : ""}
                    {lastSnapshot ? " · 有上次快照" : ""}
                </span>
                {open ? <ChevronUp className="size-3 opacity-50" /> : <ChevronDown className="size-3 opacity-50" />}
            </button>

            {open ? (
                <div className="space-y-2 border-t px-2 py-2" style={{ borderColor: theme.toolbar.border }}>
                    {snapshot.warnings.length ? (
                        <ul className="space-y-0.5 rounded-md px-2 py-1.5 text-[9px] leading-4" style={{ background: `${theme.accent.primary}12`, color: theme.node.muted }}>
                            {snapshot.warnings.map((warning) => (
                                <li key={warning}>• {warning}</li>
                            ))}
                        </ul>
                    ) : null}

                    <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="font-medium opacity-80">将发送的提示词</span>
                            <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={() => void copyEffective()}>
                                <Copy className="size-2.5" />
                                复制
                            </button>
                        </div>
                        <pre className="thin-scrollbar max-h-28 overflow-auto whitespace-pre-wrap rounded-md px-2 py-1.5 text-[10px] leading-4" style={{ background: theme.canvas.background, color: theme.node.muted }}>
                            {snapshot.effectivePrompt.trim() || "（空）"}
                        </pre>
                    </div>

                    <div>
                        <div className="mb-1 font-medium opacity-80">参考清单（可取消发送）</div>
                        {snapshot.references.length ? (
                            <div className="space-y-1">
                                {snapshot.references.map((reference) => (
                                    <label key={`${reference.id}-${reference.kind}`} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/5">
                                        <Checkbox
                                            className="!mt-0.5"
                                            checked={reference.included}
                                            disabled={reference.role === "first_frame" || reference.role === "last_frame"}
                                            onChange={(event) => toggleIncluded(reference.nodeId || reference.id, event.target.checked)}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex flex-wrap items-center gap-1">
                                                <span className="font-medium">{reference.label}</span>
                                                <span className="rounded px-1 py-0.5 text-[8px] opacity-60" style={{ background: theme.toolbar.itemHover }}>
                                                    {kindLabel(reference.kind)} · {canvasReferenceRoleLabel(reference.role)}
                                                </span>
                                                <span className="rounded px-1 py-0.5 text-[8px] opacity-50" style={{ background: theme.toolbar.itemHover }}>
                                                    {sourceLabel(reference.source)}
                                                </span>
                                            </span>
                                            {reference.reason ? <span className="mt-0.5 block text-[9px] opacity-50">{reference.reason}</span> : null}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-md px-2 py-2 text-[9px] leading-4 opacity-60" style={{ background: theme.canvas.background }}>
                                当前没有可引用的上游节点。连接图片 / 视频 / 角色节点后，会出现在这里，也可用 @ 插入。
                            </div>
                        )}
                    </div>

                    {lastSnapshot ? (
                        <div className="border-t pt-2" style={{ borderColor: theme.toolbar.border }}>
                            <button type="button" className="mb-1 flex w-full items-center justify-between gap-2 text-left font-medium opacity-80 hover:opacity-100" onClick={() => setShowLast((value) => !value)}>
                                <span>上次实际发送（{lastSnapshot.pathLabel}{lastSnapshot.createdAt ? ` · ${new Date(lastSnapshot.createdAt).toLocaleString()}` : ""}）</span>
                                {showLast ? <ChevronUp className="size-3 opacity-50" /> : <ChevronDown className="size-3 opacity-50" />}
                            </button>
                            {showLast ? (
                                <div className="space-y-1.5">
                                    <pre className="thin-scrollbar max-h-24 overflow-auto whitespace-pre-wrap rounded-md px-2 py-1.5 text-[10px] leading-4" style={{ background: theme.canvas.background, color: theme.node.muted }}>
                                        {lastSnapshot.effectivePrompt.trim() || "（空）"}
                                    </pre>
                                    <div className="text-[9px] opacity-60">
                                        参考 {lastSnapshot.references.filter((item) => item.included).length}/{lastSnapshot.references.length}
                                        {lastSnapshot.mentions.length ? ` · @${lastSnapshot.mentions.length}` : ""}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export function useLiveSubmissionSnapshot(options: {
    node: CanvasNodeData;
    mode: CanvasGenerationMode;
    userPrompt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    model?: string;
}): GenerationSubmissionSnapshot {
    return useMemo(
        () =>
            buildGenerationSubmissionSnapshot({
                nodeId: options.node.id,
                mode: options.mode,
                userPrompt: options.userPrompt,
                nodes: options.nodes,
                connections: options.connections,
                excludedReferenceNodeIds: options.node.metadata?.excludedReferenceNodeIds,
                model: options.model,
            }),
        [options.connections, options.mode, options.model, options.node, options.nodes, options.userPrompt],
    );
}

function kindLabel(kind: string) {
    switch (kind) {
        case "image":
            return "图片";
        case "video":
            return "视频";
        case "audio":
            return "音频";
        case "character":
            return "角色";
        case "skill":
            return "技能";
        default:
            return "文本";
    }
}

function sourceLabel(source: string) {
    switch (source) {
        case "mention":
            return "@ 引用";
        case "connection":
            return "连线";
        case "storyboard":
            return "分镜";
        case "frame":
            return "首尾帧";
        default:
            return "自动";
    }
}
