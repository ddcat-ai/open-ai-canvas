import { ArrowRight, CircleAlert, Image as ImageIcon, ShieldAlert, ShieldCheck } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { PORTRAIT_CLEARANCE_PLUGIN_ID, PORTRAIT_RISK_LABELS, type PortraitClearanceInputRole, type PortraitRiskLevel } from "@/lib/portrait-clearance/contracts";
import { isPortraitImageInput } from "@/lib/portrait-clearance/input-bindings";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import { useCanvasNodeActions } from "../canvas-node-action-context";
import { useUpstreamNodes } from "../canvas-node-graph-context";
import { PortraitClearanceIcon } from "../portrait-clearance/portrait-clearance-icon";

type PortraitClearanceNodeProps = {
    node: CanvasNodeData;
};

const roleLabels: Record<PortraitClearanceInputRole, string> = {
    query: "查询图",
    reference: "参考图",
    candidate: "手动候选",
};

export function PortraitClearanceNodeContent({ node }: PortraitClearanceNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const enabled = usePluginStore((state) => state.pluginStates[PORTRAIT_CLEARANCE_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PORTRAIT_CLEARANCE_PLUGIN_ID)?.enabled));
    const { openPortraitClearance } = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id).filter((item) => isPortraitImageInput(item));
    const state = node.metadata?.portraitClearance;
    const bindings = state?.inputBindings || [];
    const roleByNodeId = new Map(bindings.map((binding) => [binding.nodeId, binding.role]));
    const query = upstream.find((item) => roleByNodeId.get(item.id) === "query") || upstream[0];
    const reference = upstream.find((item) => roleByNodeId.get(item.id) === "reference") || upstream[1];
    const candidates = upstream.filter((item) => (roleByNodeId.get(item.id) || "candidate") === "candidate");
    const task = state?.task;
    const lastResult = state?.lastResult;
    const risk = lastResult?.highestRisk;
    const title = state?.mode === "network-search" ? "网络排查" : "直接比对";

    return (
        <div
            className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden rounded-[inherit] p-3"
            style={{ background: theme.node.panel, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: theme.toolbar.itemHover, color: theme.accent.primary }}>
                    <PortraitClearanceIcon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[var(--fs-label)] font-semibold">{title}</div>
                    <div className="truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{enabled ? "本地预检 · 结果保存在本机" : "插件已停用 · 历史结果只读"}</div>
                </div>
                {risk ? <RiskBadge risk={risk} /> : null}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
                <InputSlot label={roleLabels.query} node={query} />
                {state?.mode === "network-search" ? (
                    <InputSlot label={`${roleLabels.candidate} ${candidates.length ? `· ${candidates.length}` : ""}`} node={candidates[0]} count={candidates.length} />
                ) : (
                    <InputSlot label={roleLabels.reference} node={reference} />
                )}
            </div>

            {task && !isTerminal(task.status) ? <div className="flex min-h-9 items-center gap-2 rounded-[var(--r-md)] border px-2.5 py-2" style={{ borderColor: theme.node.edge, background: theme.node.fill }}><TaskSummary stage={task.stage} progress={task.progress} processed={task.processedCandidates} /></div> : lastResult ? null : <div className="flex min-h-9 items-center gap-2 rounded-[var(--r-md)] border px-2.5 py-2" style={{ borderColor: theme.node.edge, background: theme.node.fill }}><EmptySummary mode={state?.mode || "direct-compare"} /></div>}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    data-canvas-no-zoom
                    className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--r-md)] px-4 text-[var(--fs-label)] font-semibold outline-none transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: theme.accent.primary, color: theme.accent.onPrimary, outlineColor: theme.accent.primary }}
                    disabled={!enabled && !lastResult}
                    onClick={(event) => { event.stopPropagation(); openPortraitClearance?.(node); }}
                >
                    {lastResult ? "查看完整结果" : "打开排查工作台"}
                    <ArrowRight className="size-4" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

function InputSlot({ label, node, count = 0 }: { label: string; node?: CanvasNodeData; count?: number }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const preview = node?.metadata?.previewContent || node?.metadata?.content || "";
    return (
        <div className="relative min-h-0 overflow-hidden rounded-[var(--r-md)] border" style={{ borderColor: theme.node.edge, background: theme.node.fill }}>
            {preview && node?.type === CanvasNodeType.Image ? <img src={preview} alt="" className="absolute inset-0 size-full object-contain" draggable={false} /> : <div className="absolute inset-0 grid place-items-center"><ImageIcon className="size-6 opacity-30" aria-hidden="true" /></div>}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-white">
                <span className="truncate text-[var(--fs-micro)] font-semibold">{label}</span>
                {count > 0 ? <span className="shrink-0 text-[var(--fs-micro)]">{count}</span> : null}
            </div>
        </div>
    );
}

function RiskBadge({ risk }: { risk: PortraitRiskLevel }) {
    const tone = risk === "high" ? "var(--status-error)" : risk === "unable_to_determine" ? "var(--status-warning)" : "var(--status-success)";
    const Icon = risk === "high" ? ShieldAlert : risk === "unable_to_determine" ? CircleAlert : ShieldCheck;
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[var(--fs-micro)] font-semibold" style={{ color: tone, background: `color-mix(in oklch, ${tone} 15%, transparent)` }}><Icon className="size-3" aria-hidden="true" />{PORTRAIT_RISK_LABELS[risk]}</span>;
}

function TaskSummary({ stage, progress, processed }: { stage: string; progress: number; processed: number }) {
    const percent = progress >= 1 ? 100 : Math.min(99, Math.round(Math.max(0, Math.min(1, progress)) * 100));
    return <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2 text-[var(--fs-micro)]"><span className="truncate">{stage}</span><span className="shrink-0 tabular-nums">{percent}% · {processed} 张</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-[var(--workspace-accent)] transition-[width]" style={{ width: `${percent}%` }} /></div></div>;
}

function EmptySummary({ mode }: { mode: "direct-compare" | "network-search" }) {
    return <div className="flex min-w-0 flex-1 items-center gap-2 text-[var(--fs-micro)] text-[var(--foreground-muted)]"><PortraitClearanceIcon className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{mode === "network-search" ? "连接查询图后可开始百度识图排查" : "连接查询图和参考图后可开始直接比对"}</span></div>;
}

function isTerminal(status: string) {
    return ["partial", "completed", "failed", "cancelled"].includes(status);
}
