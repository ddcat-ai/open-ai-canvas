import { CheckCircle2, CircleAlert, FileText, Image as ImageIcon, LoaderCircle, Music2, Video } from "lucide-react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import type { GenerationTask } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

export type CanvasAssistantResultItem = {
    nodeId: string;
    title: string;
    nodeType: CanvasNodeTypeId;
    status: "idle" | "pending" | "processing" | "completed" | "failed";
    taskId?: string;
    conversationId?: string;
    messageId?: string;
    storageKey?: string;
    previewContent?: string;
    previewUrl?: string;
};

type CanvasAgentResultsViewProps = {
    nodes: CanvasNodeData[];
    tasks?: GenerationTask[];
    theme: CanvasTheme;
    onSelectNode: (nodeId: string) => void;
};

export function buildCanvasAssistantResults(nodes: CanvasNodeData[], tasks: GenerationTask[] = []): CanvasAssistantResultItem[] {
    const tasksByNodeId = new Map(tasks.map((task) => [task.clientContext?.nodeId || "", task]));
    return nodes
        .filter((node) => isGeneratedCanvasNode(node))
        .map((node) => {
            const metadata = node.metadata;
            const task = metadata?.taskId ? tasks.find((item) => item.id === metadata.taskId) : tasksByNodeId.get(node.id);
            const status = resultStatus(node, task);
            return {
                nodeId: node.id,
                title: node.title || "未命名结果",
                nodeType: node.type,
                status,
                taskId: metadata?.taskId || task?.id,
                conversationId: metadata?.agentGenerationContinuation?.conversationId || task?.clientContext?.conversationId,
                messageId: metadata?.agentGenerationContinuation?.messageId || task?.clientContext?.messageId,
                storageKey: metadata?.storageKey,
                previewContent: metadata?.previewContent,
                previewUrl: task?.previewUrl,
            } satisfies CanvasAssistantResultItem;
        })
        .sort((left, right) => resultRank(right.status) - resultRank(left.status));
}

export function CanvasAgentResultsView({ nodes, tasks = [], theme, onSelectNode }: CanvasAgentResultsViewProps) {
    const results = buildCanvasAssistantResults(nodes, tasks);
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-label="生成结果">
            <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold" style={{ color: theme.node.text }}>生成结果</div>
                    <div className="mt-1 text-xs" style={{ color: theme.node.muted }}>从画布节点和当前任务中汇总制作产物</div>
                </div>
                <span className="rounded-full px-2 py-1 text-[var(--fs-label)] font-semibold" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>{results.length}</span>
            </div>
            {results.length ? (
                <div className="space-y-2">
                    {results.map((result) => <ResultCard key={result.nodeId} result={result} theme={theme} onClick={() => onSelectNode(result.nodeId)} />)}
                </div>
            ) : (
                <div className="grid min-h-56 place-items-center rounded-[var(--r-lg)] border border-dashed px-6 text-center" style={{ borderColor: theme.surface.border, background: theme.surface.inset }}>
                    <div>
                        <span className="mx-auto grid size-10 place-items-center rounded-xl" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}><ImageIcon className="size-5" /></span>
                        <div className="mt-3 text-sm font-medium" style={{ color: theme.node.text }}>还没有生成结果</div>
                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>Agent 生成或写回画布的节点会出现在这里。</div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ResultCard({ result, theme, onClick }: { result: CanvasAssistantResultItem; theme: CanvasTheme; onClick: () => void }) {
    const Icon = resultIcon(result.nodeType);
    const imagePreview = result.previewUrl || (isImageUrl(result.previewContent) ? result.previewContent : undefined);
    return (
        <button type="button" className="canvas-agent-result-card group flex w-full items-center gap-3 rounded-[var(--r-lg)] border p-2.5 text-left transition-[background,border-color,transform] hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ borderColor: theme.surface.border, background: theme.surface.inset, color: theme.node.text }} onClick={onClick}>
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-[var(--r-md)]" style={{ background: theme.spatial.surface, color: theme.accent.primary }}>
                {imagePreview ? <img src={imagePreview} alt="" className="size-full object-cover" loading="lazy" decoding="async" /> : <Icon className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{result.title}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}><StatusIcon status={result.status} theme={theme} />{statusLabel(result.status)}{result.taskId ? <span className="truncate opacity-60">· {result.taskId.slice(0, 8)}</span> : null}</span>
            </span>
            <span className="shrink-0 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" style={{ color: theme.accent.primary }}>定位</span>
        </button>
    );
}

function isGeneratedCanvasNode(node: CanvasNodeData) {
    const metadata = node.metadata;
    return Boolean(metadata?.taskId || metadata?.generationBatches?.length || metadata?.agentGenerationContinuation || (metadata?.prompt && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(node.type as CanvasNodeType)));
}

function resultStatus(node: CanvasNodeData, task?: GenerationTask): CanvasAssistantResultItem["status"] {
    if (task?.status === "running" || task?.status === "queued" || node.metadata?.status === "loading") return "processing";
    if (task?.status === "failed" || task?.status === "cancelled" || node.metadata?.status === "error") return "failed";
    if (task?.status === "succeeded" || node.metadata?.status === "success" || node.metadata?.storageKey || node.metadata?.content) return "completed";
    return "pending";
}

function resultRank(status: CanvasAssistantResultItem["status"]) {
    return { processing: 4, pending: 3, completed: 2, failed: 1, idle: 0 }[status];
}

function statusLabel(status: CanvasAssistantResultItem["status"]) {
    return { idle: "待开始", pending: "等待生成", processing: "生成中", completed: "已完成", failed: "生成失败" }[status];
}

function StatusIcon({ status, theme }: { status: CanvasAssistantResultItem["status"]; theme: CanvasTheme }) {
    if (status === "processing" || status === "pending") return <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" style={{ color: theme.accent.warning }} />;
    if (status === "failed") return <CircleAlert className="size-3.5" style={{ color: theme.accent.danger }} />;
    if (status === "completed") return <CheckCircle2 className="size-3.5" style={{ color: theme.accent.status }} />;
    return <span className="size-1.5 rounded-full" style={{ background: theme.node.muted }} />;
}

function resultIcon(type: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Video) return Video;
    if (type === CanvasNodeType.Audio) return Music2;
    if (type === CanvasNodeType.Text || type === CanvasNodeType.Script) return FileText;
    return ImageIcon;
}

function isImageUrl(value?: string): value is string {
    return Boolean(value && /^(?:data:image\/|https?:\/\/|\/)/u.test(value));
}
