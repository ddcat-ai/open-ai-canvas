import { Alert, Button, InputNumber, Modal, Popconfirm, Segmented, Select, Switch, Tag } from "antd";
import { CircleAlert, Download, History, Image as ImageIcon, Pause, Play, ScanFace, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createDefaultPortraitClearanceState, PORTRAIT_CLEARANCE_PLUGIN_ID, PORTRAIT_RISK_LABELS, PORTRAIT_TASK_STAGE_LABELS, type PortraitClearanceAnalysisMode, type PortraitClearanceMode, type PortraitClearanceNodeState } from "@/lib/portrait-clearance/contracts";
import { isPortraitImageInput, swapPortraitClearanceDirectBindings } from "@/lib/portrait-clearance/input-bindings";
import { portraitVisionModelError, portraitVisionModelLabel, portraitVisionModels, resolvePortraitVisionModel } from "@/lib/portrait-clearance/vision";
import { usePluginStore } from "@/stores/use-plugin-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { cancelPortraitTask, createPortraitClearanceTask, deletePortraitTask, downloadPortraitReport, imageNodeDataUrl, installPortraitClearanceModels, listPortraitTasks, portraitOwnerScopeHash, readPortraitRuntimeStatus, readPortraitTaskResult, retryPortraitTask, type PortraitRuntimeStatus, type PortraitRuntimeTask } from "@/services/portrait-clearance-runtime";
import type { PortraitFeatureKey, PortraitPairResult, PortraitRiskLevel } from "@/lib/portrait-clearance/contracts";

type PortraitClearanceModalProps = {
    projectId: string;
    node: CanvasNodeData | null;
    upstreamNodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateState: (nodeId: string, state: PortraitClearanceNodeState) => void;
    onAddCandidate?: (candidate: { id: string; title: string; imageArtifactId: string }, dataUrl: string) => void | Promise<void>;
};

export function PortraitClearanceModal({ projectId, node, upstreamNodes, open, onClose, onUpdateState, onAddCandidate }: PortraitClearanceModalProps) {
    const effectiveConfig = useEffectiveConfig();
    const enabled = usePluginStore((state) => state.pluginStates[PORTRAIT_CLEARANCE_PLUGIN_ID]?.effectiveEnabled ?? Boolean(state.installations.find((item) => item.manifest.id === PORTRAIT_CLEARANCE_PLUGIN_ID)?.enabled));
    const state = node?.metadata?.portraitClearance || createDefaultPortraitClearanceState();
    const [starting, setStarting] = useState(false);
    const [installingModels, setInstallingModels] = useState(false);
    const [runtimeStatus, setRuntimeStatus] = useState<PortraitRuntimeStatus | null>(null);
    const [runtimeConnecting, setRuntimeConnecting] = useState(false);
    const [runtimeRetryNonce, setRuntimeRetryNonce] = useState(0);
    const [runtimeError, setRuntimeError] = useState("");
    const [history, setHistory] = useState<PortraitRuntimeTask[]>([]);
    const [result, setResult] = useState<PortraitResultView | null>(null);
    const [reportFormat, setReportFormat] = useState<"json" | "md" | "html" | "docx">("html");
    const [busyAction, setBusyAction] = useState("");
    const imageInputs = useMemo(() => upstreamNodes.filter((item) => isPortraitImageInput(item)), [upstreamNodes]);
    const hasQuery = Boolean(state.inputBindings.some((binding) => binding.role === "query" && imageInputs.some((item) => item.id === binding.nodeId)));
    const hasReference = Boolean(state.inputBindings.some((binding) => binding.role === "reference" && imageInputs.some((item) => item.id === binding.nodeId)));
    const query = imageInputs.find((item) => state.inputBindings.some((binding) => binding.nodeId === item.id && binding.role === "query")) || imageInputs[0];
    const reference = imageInputs.find((item) => state.inputBindings.some((binding) => binding.nodeId === item.id && binding.role === "reference")) || imageInputs[1];
    const candidateNodes = useMemo(() => imageInputs.filter((item) => {
        if (item.id === query?.id) return false;
        const binding = state.inputBindings.find((candidate) => candidate.nodeId === item.id);
        return binding?.role === "candidate" || (!binding && state.mode === "network-search");
    }), [imageInputs, query?.id, state.inputBindings, state.mode]);
    const runtimeReady = Boolean(runtimeStatus?.ready);
    const selectedModel = state.analysisMode === "local-plus-vision" ? resolvePortraitVisionModel(effectiveConfig, state.modelPolicy) : "";
    const visionModelError = state.analysisMode === "local-plus-vision" ? portraitVisionModelError(effectiveConfig, state.modelPolicy) : "";
    const canStart = enabled && runtimeReady && !visionModelError && (state.mode === "network-search" ? hasQuery : hasQuery && hasReference);

    useEffect(() => {
        if (!open || !enabled) return;
        let disposed = false;
        let retryTimer: number | undefined;
        let attempt = 0;
        const load = async () => {
            if (disposed) return;
            setRuntimeConnecting(true);
            try {
                const status = await readPortraitRuntimeStatus();
                if (disposed) return;
                setRuntimeStatus(status);
                setRuntimeError("");
                attempt = 0;
            } catch (error) {
                if (disposed) return;
                setRuntimeStatus(null);
                setRuntimeError(error instanceof Error ? error.message : "本机肖像引擎不可用");
                attempt += 1;
                retryTimer = window.setTimeout(load, Math.min(5_000, 800 + attempt * 700));
            } finally {
                if (!disposed) setRuntimeConnecting(false);
            }
        };
        setRuntimeStatus(null);
        setRuntimeError("");
        void load();
        return () => {
            disposed = true;
            if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        };
    }, [enabled, open, runtimeRetryNonce]);

    useEffect(() => {
        if (!open || !node) return;
        let disposed = false;
        void listPortraitTasks({ projectId, nodeId: node.id, limit: 40 }).then((page) => { if (!disposed) setHistory(page.tasks); }).catch(() => { if (!disposed) setHistory([]); });
        return () => { disposed = true; };
    }, [node, open, projectId, state.activeTaskId]);

    useEffect(() => {
        if (!open || !node?.metadata?.portraitClearance?.lastResult?.taskId) return;
        let disposed = false;
        void readPortraitTaskResult(node.metadata.portraitClearance.lastResult.taskId).then((value) => {
            if (disposed) return;
            const parsed = parsePortraitResult(value);
            setResult(parsed);
            const lastResult = node.metadata?.portraitClearance?.lastResult;
            if (lastResult && (lastResult.comparedCount !== parsed.comparedCount || lastResult.highestRisk !== parsed.highestRisk)) {
                onUpdateState(node.id, { ...(node.metadata?.portraitClearance || createDefaultPortraitClearanceState()), lastResult: { ...lastResult, comparedCount: parsed.comparedCount, candidateCount: parsed.candidateCount, highestRisk: parsed.highestRisk, riskCounts: parsed.riskCounts } });
            }
        }).catch(() => { if (!disposed) setResult(null); });
        return () => { disposed = true; };
    }, [node, open]);

    const patchState = (patch: Partial<PortraitClearanceNodeState>) => {
        if (!node) return;
        onUpdateState(node.id, { ...state, ...patch, settings: { ...state.settings, ...(patch.settings || {}) } });
    };

    const startTask = async () => {
        if (!node || !canStart || starting) return;
        setStarting(true);
        setRuntimeError("");
        try {
            const ownerScopeHash = await portraitOwnerScopeHash();
            const inputNodes = imageInputs.filter((item) => {
                const binding = state.inputBindings.find((candidate) => candidate.nodeId === item.id);
                if (state.mode === "direct-compare") return binding?.role === "query" || binding?.role === "reference" || (!binding && (item.id === query?.id || item.id === reference?.id));
                return binding?.role === "query" || binding?.role === "candidate" || (!binding && item.id === query?.id);
            });
            const inputs = await Promise.all(inputNodes.map(async (item) => {
                const binding = state.inputBindings.find((candidate) => candidate.nodeId === item.id);
                const role = binding?.role || (item.id === query?.id ? "query" : state.mode === "direct-compare" ? "reference" : "candidate");
                const file = await imageNodeDataUrl(item);
                return { ...file, nodeId: item.id, role };
            }));
            const inputBytes = inputs.reduce((total, item) => total + decodedDataUrlBytes(item.dataUrl), 0);
            if (inputBytes > 20 * 1024 * 1024) throw new Error("肖像排查图片总大小不能超过 20MB");
            const task = await createPortraitClearanceTask({
                projectId,
                nodeId: node.id,
                ownerScopeHash,
                clientOperationId: `portrait-${node.id}-${Date.now()}`,
                mode: state.mode,
                analysisMode: state.analysisMode,
                ...(selectedModel ? { modelRef: selectedModel } : {}),
                settings: state.settings,
                inputs,
            });
            onUpdateState(node.id, {
                ...state,
                activeTaskId: task.taskId,
                task: { status: task.status, stage: task.stage, progress: task.progress, processedCandidates: task.processedCandidates, ...(task.totalCandidates === undefined ? {} : { totalCandidates: task.totalCandidates }), ...(task.errorCode ? { errorCode: task.errorCode } : {}), ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}), updatedAt: task.updatedAt },
            });
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "本机肖像任务创建失败");
        } finally {
            setStarting(false);
        }
    };

    const stopTask = async () => {
        if (!state.activeTaskId || busyAction) return;
        setBusyAction("stop");
        try {
            const task = await cancelPortraitTask(state.activeTaskId);
            // Keep the durable task id after stopping so the user can retry the same
            // local task without losing its downloaded candidates and audit trail.
            if (node) onUpdateState(node.id, { ...state, activeTaskId: state.activeTaskId, task: { status: task.status, stage: task.stage, progress: task.progress, processedCandidates: task.processedCandidates, ...(task.errorCode ? { errorCode: task.errorCode } : {}), ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}), updatedAt: task.updatedAt } });
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "停止任务失败");
        } finally {
            setBusyAction("");
        }
    };

    const retryTask = async () => {
        if (!node || !state.task || !state.task.errorCode || (!state.activeTaskId && !state.lastResult?.taskId)) return;
        const taskId = state.activeTaskId || state.lastResult?.taskId;
        if (!taskId || busyAction) return;
        setBusyAction("retry");
        try {
            const task = await retryPortraitTask(taskId);
            onUpdateState(node.id, { ...state, activeTaskId: task.taskId, task: { status: task.status, stage: task.stage, progress: task.progress, processedCandidates: task.processedCandidates, updatedAt: task.updatedAt }, lastResult: undefined });
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "重试任务失败");
        } finally {
            setBusyAction("");
        }
    };

    const exportReport = async () => {
        const taskId = state.lastResult?.taskId;
        if (!taskId || busyAction) return;
        setBusyAction("export");
        try {
            const artifactId = reportFormat === "json" ? "clearance-result.json" : `clearance-report.${reportFormat}` as "clearance-report.md" | "clearance-report.html" | "clearance-report.docx";
            const report = await downloadPortraitReport(taskId, artifactId);
            const extension = reportFormat;
            const blob = new Blob([report.bytes], { type: report.mimeType });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `portrait-clearance-${taskId}.${extension}`;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "导出报告失败");
        } finally {
            setBusyAction("");
        }
    };

    const removeHistory = async (taskId: string) => {
        if (busyAction) return;
        setBusyAction(`delete-${taskId}`);
        try {
            await deletePortraitTask(taskId);
            setHistory((current) => current.filter((item) => item.taskId !== taskId));
            if (state.lastResult?.taskId === taskId && node) onUpdateState(node.id, { ...state, lastResult: undefined });
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "删除本地排查数据失败");
        } finally {
            setBusyAction("");
        }
    };

    const openHistoryTask = async (task: PortraitRuntimeTask) => {
        if (!node || busyAction) return;
        setBusyAction(`open-${task.taskId}`);
        try {
            const value = parsePortraitResult(await readPortraitTaskResult(task.taskId));
            setResult(value);
            onUpdateState(node.id, { ...state, activeTaskId: undefined, task: { status: task.status, stage: task.stage, progress: task.progress, processedCandidates: task.processedCandidates, ...(task.totalCandidates === undefined ? {} : { totalCandidates: task.totalCandidates }), ...(task.errorCode ? { errorCode: task.errorCode } : {}), ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}), updatedAt: task.updatedAt }, lastResult: { taskId: task.taskId, highestRisk: value.highestRisk, riskCounts: value.riskCounts, candidateCount: value.candidateCount, comparedCount: value.comparedCount, ...(task.modelRef ? { modelRef: task.modelRef } : {}), completedAt: task.completedAt || task.updatedAt, detailsAvailable: true } });
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "读取历史排查结果失败");
        } finally {
            setBusyAction("");
        }
    };

    const installModels = async () => {
        if (installingModels) return;
        setInstallingModels(true);
        setRuntimeError("");
        try {
            setRuntimeStatus(await installPortraitClearanceModels());
        } catch (error) {
            setRuntimeError(error instanceof Error ? error.message : "本地肖像模型安装失败");
        } finally {
            setInstallingModels(false);
        }
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            title={null}
            closable={false}
            width="min(1600px, calc(100vw - 32px))"
            centered
            destroyOnHidden={false}
            className="portrait-clearance-modal"
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}
        >
            <div className="flex max-h-[calc(100dvh-32px)] min-h-[min(680px,calc(100dvh-32px))] flex-col overflow-hidden bg-background text-foreground">
                <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background"><ScanFace className="size-5" aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-base font-semibold">{node?.title || "肖像可识别性排查"}</h2>
                        <p className="mt-0.5 text-xs text-foreground/55">本地人脸预检、候选排查与审慎风险报告</p>
                    </div>
                    <Tag icon={enabled ? <ShieldCheck className="size-3" /> : <CircleAlert className="size-3" />} color={enabled ? "green" : "default"} style={enabled ? undefined : portraitRiskTagStyle("medium")} title={enabled ? "本地肖像排查功能可用" : "已有节点、摘要和本机历史仍可查看；重新运行前请到插件中心启用肖像排查。"}>{enabled ? "插件已启用" : "插件已停用"}</Tag>
                    <Button aria-label="关闭排查工作台" onClick={onClose}>关闭</Button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-5" data-canvas-wheel-scroll style={{ scrollPaddingBottom: 96 }}>
                    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                        <aside className="flex min-w-0 flex-col gap-4">
                            <section className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                                <div className="mb-2 text-xs font-semibold text-foreground/60">排查模式</div>
                                <Segmented
                                    block
                                    value={state.mode}
                                    disabled={!enabled}
                                    onChange={(value) => patchState({ mode: value as PortraitClearanceMode })}
                                    options={[{ value: "direct-compare", label: "直接比对" }, { value: "network-search", label: "网络排查" }]}
                                />
                            </section>

                            <section className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                                <div className="mb-3 text-xs font-semibold text-foreground/60">输入图片</div>
                                <div className="space-y-2">
                                    <PortraitInputCard label="查询图" node={query} ready={hasQuery} />
                                    {state.mode === "direct-compare" ? <PortraitInputCard label="参考图" node={reference} ready={hasReference} /> : <PortraitCandidateStrip nodes={candidateNodes} />}
                                </div>
                                <p className="mt-3 text-xs leading-5 text-foreground/55">在画布上把图片节点连接到本节点，角色会写入节点状态；不会按渲染顺序静默交换 A/B。</p>
                                {state.mode === "direct-compare" ? <Button size="small" disabled={!enabled || !hasQuery || !hasReference} onClick={() => patchState({ inputBindings: swapPortraitClearanceDirectBindings(state.inputBindings) })}>交换 A / B</Button> : null}
                            </section>

                            <section className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                                <div className="mb-3 text-xs font-semibold text-foreground/60">执行设置</div>
                                <label className="mb-3 block text-xs">分析方式<Select className="mt-1 w-full" value={state.analysisMode} disabled={!enabled} options={[{ value: "local-plus-vision", label: "本地 + 视觉模型" }, { value: "local-only", label: "仅本地" }]} onChange={(value) => patchState({ analysisMode: value as PortraitClearanceAnalysisMode })} /></label>
                                {state.analysisMode === "local-plus-vision" ? <label className="mb-3 block text-xs">视觉分析模型<Select className="mt-1 w-full" value={state.modelPolicy.mode === "pinned" ? state.modelPolicy.modelRef : "project-default"} disabled={!enabled} options={[{ value: "project-default", label: `项目默认 · ${portraitVisionModelLabel(effectiveConfig, effectiveConfig.textModel || effectiveConfig.model)}` }, ...portraitVisionModels(effectiveConfig).map((model) => ({ value: model, label: portraitVisionModelLabel(effectiveConfig, model) }))]} onChange={(value) => patchState({ modelPolicy: value === "project-default" ? { mode: "project-default" } : { mode: "pinned", modelRef: String(value) } })} /></label> : null}
                                <label className="mb-3 block text-xs">去重方式<Select className="mt-1 w-full" value={state.settings.dedupMode} disabled={!enabled} options={[{ value: "phash", label: "pHash 快速" }, { value: "arcface", label: "ArcFace 双条件" }]} onChange={(value) => patchState({ settings: { ...state.settings, dedupMode: value as "phash" | "arcface" } })} /></label>
                                {state.analysisMode === "local-plus-vision" ? <label className="mb-3 block text-xs">模型并发（最多 10）<InputNumber className="mt-1 w-full" min={1} max={10} precision={0} value={state.settings.modelConcurrency} disabled={!enabled} onChange={(value) => patchState({ settings: { ...state.settings, modelConcurrency: Math.max(1, Math.min(10, Number(value) || 2)) } })} /></label> : null}
                                {state.mode === "network-search" ? <><label className="mb-3 block text-xs">候选上限<InputNumber className="mt-1 w-full" min={1} max={60} value={state.settings.maxCandidates} disabled={!enabled} onChange={(value) => patchState({ settings: { ...state.settings, maxCandidates: Math.max(1, Math.min(60, Number(value) || 30)) } })} /></label><label className="mb-3 block text-xs">百度滚动次数<InputNumber className="mt-1 w-full" min={0} max={20} value={state.settings.searchScrolls} disabled={!enabled} onChange={(value) => patchState({ settings: { ...state.settings, searchScrolls: Math.max(0, Math.min(20, Number(value) || 0)) } })} /></label></> : null}
                                <div className="flex items-center justify-between gap-3 text-xs"><span>浏览器调试</span><Switch size="small" checked={state.settings.showBrowserForDebug} disabled={!enabled} onChange={(checked) => patchState({ settings: { ...state.settings, showBrowserForDebug: checked } })} /></div>
                            </section>
                        </aside>

                        <main className="min-w-0 space-y-4">
                            {!runtimeReady && enabled ? <Alert type={runtimeConnecting ? "info" : "warning"} showIcon message={runtimeConnecting ? "正在连接本机检测引擎" : runtimeStatus ? "本地模型未就绪" : "本机引擎连接失败"} description={runtimeConnecting ? "正在自动建立本机连接，请稍候。" : runtimeStatus ? (installingModels ? "正在下载并校验本地肖像模型，请稍候。" : runtimeError || "请下载本地肖像模型后再开始排查。") : portraitRuntimeErrorMessage(runtimeError) || "正在自动重连本机引擎，请确认 Canvas Agent 已启动。"} action={runtimeConnecting ? null : runtimeStatus ? <Button size="small" icon={<Download className="size-3.5" />} loading={installingModels} onClick={() => void installModels()}>{installingModels ? "下载中…" : "下载本地模型"}</Button> : <Button size="small" onClick={() => setRuntimeRetryNonce((value) => value + 1)}>立即重连</Button>} /> : null}
                            {runtimeReady && runtimeError ? <Alert type="error" showIcon message="网络排查请求失败" description={runtimeError} closable onClose={() => setRuntimeError("")} /> : null}
                            {state.mode === "network-search" && runtimeStatus?.browser.available === false ? <Alert type="warning" showIcon message="未检测到系统浏览器" description="网络排查需要系统 Chrome、Edge 或 Chromium；也可以先连接手动候选，任务不会静默切换搜索服务。" /> : null}

                            <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div><h3 className="text-sm font-semibold">当前结果</h3><p className="mt-1 text-xs text-foreground/55">完整结果会在本机任务完成后生成；节点 metadata 只保留可恢复摘要。</p></div>
                                    {state.task ? <Tag color={state.task.status === "failed" ? "red" : state.task.status === "cancelled" ? "orange" : state.task.status === "completed" ? "green" : "blue"}>{state.task.status === "failed" ? "失败" : state.task.status === "cancelled" ? "已停止" : PORTRAIT_TASK_STAGE_LABELS[state.task.stage] || state.task.stage}</Tag> : null}
                                </div>
                                {state.task?.status === "failed" && state.task.errorMessage ? <Alert className="mt-4" type="error" showIcon message="排查任务失败" description={state.task.errorMessage} /> : null}
                                {state.lastResult ? <><div className="mt-4 grid gap-3 sm:grid-cols-4"><Metric label="最高风险" value={PORTRAIT_RISK_LABELS[state.lastResult.highestRisk]} tone={portraitRiskTone(state.lastResult.highestRisk)} /><Metric label="候选数" value={String(state.lastResult.candidateCount)} /><Metric label="已分析" value={String(result?.comparedCount ?? state.lastResult.comparedCount)} /><Metric label="详情" value={state.lastResult.detailsAvailable ? "可用" : "需重新运行"} /></div>{result ? <PortraitResultPanel result={result} taskId={state.lastResult.taskId} onAddCandidate={onAddCandidate} /> : <div className="mt-4 rounded-lg bg-foreground/[.03] p-3 text-xs text-foreground/55">正在读取本机详细结果，图片和完整模型响应不会写入画布 metadata。</div>}</> : <div className="mt-4 grid min-h-44 place-items-center rounded-lg border border-dashed text-center text-sm text-foreground/45" style={{ borderColor: "var(--border)" }}><div><ScanFace className="mx-auto mb-2 size-8 opacity-45" /><p>{canStart ? "准备好开始排查" : "先连接所需图片"}</p><p className="mt-1 text-xs">本地模式会在 Canvas Agent 中执行，关闭工作台不会取消任务。</p></div></div>}
                            </section>

                            <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
                                <div className="mb-3 flex items-center gap-2"><History className="size-4" /><h3 className="text-sm font-semibold">历史运行</h3></div>
                                {history.length ? <div className="space-y-2">{history.map((item) => <div key={item.taskId} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}><span className="min-w-24 font-medium">{item.mode === "direct-compare" ? "直接比对" : "网络排查"}</span><Tag color={item.status === "completed" ? "green" : item.status === "failed" ? "red" : item.status === "partial" ? "orange" : "blue"}>{PORTRAIT_TASK_STAGE_LABELS[item.stage] || item.status}</Tag><span className="text-foreground/55">{item.processedCandidates}{item.totalCandidates ? ` / ${item.totalCandidates}` : ""} 项</span><span className="ml-auto text-foreground/45">{formatDate(item.updatedAt)}</span><Button size="small" type="link" onClick={() => void openHistoryTask(item)}>查看</Button><Popconfirm title="删除本地排查数据？" description="报告、候选和本机任务将不可恢复。" onConfirm={() => void removeHistory(item.taskId)}><Button size="small" type="link" danger loading={busyAction === `delete-${item.taskId}`}>删除</Button></Popconfirm></div>)}</div> : <div className="rounded-lg bg-foreground/[.03] p-3 text-xs leading-5 text-foreground/55">暂无当前节点历史。不会建立跨项目的人脸身份索引。</div>}
                            </section>
                        </main>
                    </div>
                </div>

                <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 text-xs text-foreground/55"><CircleAlert className="size-3.5" />结果不能替代司法鉴定、律师意见或法院判断。</div>
                    <div className="flex flex-wrap items-center justify-end gap-2"><Select size="small" value={reportFormat} disabled={!state.lastResult || Boolean(busyAction)} options={[{ value: "html", label: "HTML 报告" }, { value: "md", label: "Markdown 报告" }, { value: "docx", label: "DOCX 报告" }, { value: "json", label: "JSON 结果" }]} onChange={(value) => setReportFormat(value as "json" | "md" | "html" | "docx")} /><Button icon={<Download className="size-3.5" />} loading={busyAction === "export"} disabled={!state.lastResult} onClick={() => void exportReport()}>导出</Button>{state.activeTaskId && state.task?.status !== "failed" && state.task?.status !== "cancelled" ? <Popconfirm title="停止当前排查？" description="已下载的候选和本机任务会保留，可稍后查看或重试。" onConfirm={() => void stopTask()}><Button danger icon={<Pause className="size-3.5" />} loading={busyAction === "stop"}>停止</Button></Popconfirm> : null}{state.task?.status === "failed" || state.task?.status === "cancelled" ? <Button icon={<Play className="size-3.5" />} loading={busyAction === "retry"} onClick={() => void retryTask()}>重试</Button> : null}<Button type="primary" icon={<Play className="size-3.5" />} loading={starting} disabled={!canStart} onClick={() => void startTask()}>开始排查</Button></div>
                </footer>
            </div>
        </Modal>
    );
}

function decodedDataUrlBytes(dataUrl: string) {
    const payload = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/=+$/, "");
    return Math.floor(payload.length * 3 / 4);
}

function PortraitInputCard({ label, node, ready }: { label: string; node?: CanvasNodeData; ready: boolean }) {
    const preview = portraitNodePreview(node);
    return <div className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-foreground/[.04]">
            {preview ? <img src={preview} alt="" className="size-full object-cover" loading="lazy" draggable={false} /> : <ImageIcon className="size-4 text-foreground/35" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{label}</div>
            <div className="truncate text-[11px] text-foreground/50">{node?.title || (ready ? "已连接图片" : "待连接")}</div>
        </div>
        <Tag color={ready ? "green" : "orange"}>{ready ? "已连接" : "待连接"}</Tag>
    </div>;
}

function PortraitCandidateStrip({ nodes }: { nodes: CanvasNodeData[] }) {
    return <div className="rounded-lg border p-2" style={{ borderColor: "var(--border)" }}>
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">手动候选</span>
            <Tag color={nodes.length ? "green" : "default"}>{nodes.length ? `${nodes.length} 张` : "可选"}</Tag>
        </div>
        {nodes.length ? <div className="grid grid-cols-4 gap-1.5">{nodes.slice(0, 4).map((item, index) => {
            const preview = portraitNodePreview(item);
            return <div key={item.id} className="min-w-0">
                <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-foreground/[.04]">
                    {preview ? <img src={preview} alt="" className="size-full object-cover" loading="lazy" draggable={false} /> : <ImageIcon className="size-4 text-foreground/35" aria-hidden="true" />}
                </div>
                <div className="mt-1 truncate text-[10px] text-foreground/55" title={item.title || `候选 ${index + 1}`}>{item.title || `候选 ${index + 1}`}</div>
            </div>;
        })}</div> : <div className="rounded-md bg-foreground/[.03] px-2 py-2 text-[11px] text-foreground/50">在画布上连接候选图片后，会在这里显示缩略图。</div>}
        {nodes.length > 4 ? <div className="mt-1 text-[10px] text-foreground/45">还有 {nodes.length - 4} 张候选图片</div> : null}
    </div>;
}

function portraitNodePreview(node?: CanvasNodeData) {
    if (!node || node.type !== CanvasNodeType.Image) return "";
    return node.metadata?.previewContent || node.metadata?.content || "";
}

type PortraitResultView = {
    taskId: string;
    mode: "direct-compare" | "network-search";
    highestRisk: PortraitRiskLevel;
    riskCounts: Partial<Record<PortraitRiskLevel, number>>;
    candidateCount: number;
    comparedCount: number;
    candidates: Array<{ id: string; title: string; imageArtifactId: string; source: "connected" | "baidu"; sourcePageUrl?: string; sourceDomain?: string; resultId?: string; originalRank: number }>;
    pairs: PortraitPairResult[];
    limitations: string[];
};

function PortraitResultPanel({ result, taskId, onAddCandidate }: { result: PortraitResultView; taskId: string; onAddCandidate?: PortraitClearanceModalProps["onAddCandidate"] }) {
    const sortedPairs = [...result.pairs].sort((left, right) => riskRank(right.riskLevel) - riskRank(left.riskLevel) || (right.overallSimilarity || 0) - (left.overallSimilarity || 0));
    return <div className="mt-4 space-y-3"><div className="flex flex-wrap gap-2">{Object.entries(result.riskCounts).map(([risk, count]) => <Tag key={risk} color="default" style={portraitRiskTagStyle(risk as PortraitRiskLevel)}>{PORTRAIT_RISK_LABELS[risk as PortraitRiskLevel]} · {count}</Tag>)}</div><div className="grid gap-3 xl:grid-cols-2">{sortedPairs.map((pair) => <ResultPairCard key={pair.id} taskId={taskId} pair={pair} candidate={result.candidates.find((candidate) => candidate.resultId === pair.id)} onAddCandidate={onAddCandidate} />)}</div>{result.limitations.length ? <div className="rounded-lg bg-foreground/[.03] p-3 text-xs leading-5 text-foreground/60"><div className="mb-1 font-semibold text-foreground/75">限制与人工复核</div>{result.limitations.map((item) => <div key={item}>· {item}</div>)}</div> : null}</div>;
}

const PORTRAIT_FEATURES: Array<{ key: PortraitFeatureKey; label: string }> = [
    { key: "face_shape", label: "脸型与下颌线" },
    { key: "facial_layout", label: "五官整体布局" },
    { key: "eyes_brows", label: "眼型与眉形" },
    { key: "nose_mouth", label: "鼻型与嘴型" },
    { key: "hair_hairline", label: "发型与发际线" },
    { key: "distinctive_features", label: "标志性特征" },
];
const PORTRAIT_FEATURE_SIMILARITY_LABELS = { high: "高度相似", medium: "中等相似", low: "低度相似", none: "无明显相似" } as const;

function ResultPairCard({ taskId, pair, candidate, onAddCandidate }: { taskId: string; pair: PortraitPairResult; candidate?: PortraitResultView["candidates"][number]; onAddCandidate?: PortraitClearanceModalProps["onAddCandidate"] }) {
    const [image, setImage] = useState("");
    useEffect(() => {
        let disposed = false;
        void import("@/services/portrait-clearance-runtime").then(({ readPortraitTaskImage }) => readPortraitTaskImage(taskId, pair.comparisonImageId)).then((value) => { if (!disposed) setImage(value.dataUrl); }).catch(() => undefined);
        return () => { disposed = true; };
    }, [pair.comparisonImageId, taskId]);
    const vision = pair.visionComparison;
    return <article className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-3 p-3">
            <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-md bg-foreground/[.04]">{image ? <img src={image} alt="" className="size-full object-contain" /> : <ScanFace className="size-6 opacity-35" />}</div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-semibold">{candidate?.title || pair.comparisonImageId}</span><Tag color="default" style={portraitRiskTagStyle(pair.riskLevel)}>{PORTRAIT_RISK_LABELS[pair.riskLevel]}</Tag><Tag color={pair.status === "failed" ? "red" : pair.status === "partial" ? "orange" : "green"}>{pair.status === "failed" ? "失败/跳过" : pair.status === "partial" ? "部分完成" : "完成"}</Tag></div>
                <div className="mt-1 text-xs text-foreground/55">{candidate?.sourceDomain || pair.source} · {pair.analysisPath === "unable" ? "无法形成可靠路径" : `Path ${pair.analysisPath}`}{pair.overallSimilarity === undefined ? "" : ` · 相似度 ${pair.overallSimilarity.toFixed(4)}`}</div>
                <div className="mt-1 flex flex-wrap gap-2">{candidate?.sourcePageUrl ? <button type="button" className="text-xs text-[var(--workspace-accent)] underline" onClick={() => window.open(candidate.sourcePageUrl, "_blank", "noopener,noreferrer")}>打开来源页面</button> : null}{onAddCandidate && candidate && image ? <button type="button" className="text-xs text-[var(--workspace-accent)] underline" onClick={() => void onAddCandidate({ id: candidate.id, title: candidate.title, imageArtifactId: candidate.imageArtifactId }, image)}>添加到画布</button> : null}</div>
            </div>
        </div>
        <div className="border-t px-3 py-2 text-xs leading-5" style={{ borderColor: "var(--border)" }}>
            <div><span className="text-foreground/50">本地预检：</span>人脸 {pair.localPrecheck.facesA} / {pair.localPrecheck.facesB} · 质量 {pair.localPrecheck.qualityA.grade} / {pair.localPrecheck.qualityB.grade}{pair.localPrecheck.faceSimilarity === undefined ? "" : ` · ArcFace ${pair.localPrecheck.faceSimilarity.toFixed(4)}`}</div>
            {pair.localPrecheck.reliabilityIssues.length ? <div className="mt-1 text-foreground/55"><span className="text-foreground/50">可靠性问题：</span>{pair.localPrecheck.reliabilityIssues.join("；")}</div> : null}
            {pair.error ? <div className="mt-1 text-red-600"><span className="font-medium">处理说明：</span>{pair.error.message}</div> : null}
            {vision ? <>
                <div className="mt-2 flex flex-wrap items-center gap-2"><span className="font-medium">多模态面部特征分析</span><Tag color={vision.status === "success" ? "green" : "gold"}>{vision.status === "success" ? "已完成" : "无法可靠判断"}</Tag>{vision.manualReviewRecommended ? <Tag color="orange">建议人工复核</Tag> : null}</div>
                <div className="mt-2 overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[520px] text-left text-[11px]"><thead className="bg-foreground/[.04]"><tr><th className="px-2 py-1.5 font-medium">特征维度</th><th className="px-2 py-1.5 font-medium">相似度</th><th className="px-2 py-1.5 font-medium">分析说明</th></tr></thead><tbody>{PORTRAIT_FEATURES.map(({ key, label }) => { const feature = vision.featureComparison[key]; return <tr key={key} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-2 py-1.5">{label}</td><td className="px-2 py-1.5"><Tag color="default" style={portraitFeatureSimilarityStyle(feature.similarity)}>{PORTRAIT_FEATURE_SIMILARITY_LABELS[feature.similarity]}</Tag></td><td className="px-2 py-1.5 text-foreground/60">{feature.note || "-"}</td></tr>; })}</tbody></table></div>
                <div className="mt-2"><span className="text-foreground/50">视觉依据：</span>{vision.basis.join("；") || "无"}</div>
            </> : <div className="mt-1 text-foreground/55">{pair.basis.join("；") || "暂无结构化依据"}</div>}
        </div>
    </article>;
}

function parsePortraitResult(value: unknown): PortraitResultView {
    if (!isRecord(value) || typeof value.taskId !== "string" || !["direct-compare", "network-search"].includes(String(value.mode)) || typeof value.highestRisk !== "string" || !isRecord(value.riskCounts) || typeof value.candidateCount !== "number" || typeof value.comparedCount !== "number" || !Array.isArray(value.candidates) || !Array.isArray(value.pairs) || !Array.isArray(value.limitations)) throw new Error("本机肖像完整结果无效");
    return { taskId: value.taskId, mode: value.mode as PortraitResultView["mode"], highestRisk: value.highestRisk as PortraitRiskLevel, riskCounts: value.riskCounts as PortraitResultView["riskCounts"], candidateCount: value.candidateCount, comparedCount: value.comparedCount, candidates: value.candidates.filter(isCandidate), pairs: value.pairs as PortraitPairResult[], limitations: value.limitations.filter((item): item is string => typeof item === "string") };
}

function isCandidate(value: unknown): value is PortraitResultView["candidates"][number] {
    return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && typeof value.imageArtifactId === "string" && (value.source === "connected" || value.source === "baidu") && typeof value.originalRank === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function riskRank(value: PortraitRiskLevel) {
    return ({ unable_to_determine: 0, low: 1, low_to_medium: 2, medium: 3, high: 4 } as Record<PortraitRiskLevel, number>)[value];
}

function formatDate(value: string) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(time) : "刚刚";
}

function portraitRuntimeErrorMessage(message: string) {
    if (!message || /会话|session|scope|权限|重新建立|尚未建立/i.test(message)) return "";
    return message;
}

function portraitRiskTone(risk: PortraitRiskLevel) {
    if (risk === "high") return "var(--status-error)";
    if (risk === "medium" || risk === "low_to_medium") return "var(--status-warning)";
    if (risk === "low") return "var(--status-success)";
    return "var(--foreground-muted)";
}

function portraitRiskTagStyle(risk: PortraitRiskLevel) {
    const tone = risk === "high" ? "var(--status-error)" : risk === "medium" || risk === "low_to_medium" ? "var(--status-warning)" : risk === "low" ? "var(--status-success)" : "var(--foreground-muted)";
    return { color: tone, backgroundColor: `color-mix(in oklch, ${tone} 18%, transparent)`, borderColor: `color-mix(in oklch, ${tone} 42%, transparent)` };
}

function portraitFeatureSimilarityStyle(similarity: "high" | "medium" | "low" | "none") {
    const tone = similarity === "high" ? "var(--status-error)" : similarity === "medium" ? "var(--status-warning)" : similarity === "low" ? "var(--status-success)" : "var(--foreground-muted)";
    return { color: tone, backgroundColor: `color-mix(in oklch, ${tone} 18%, transparent)`, borderColor: `color-mix(in oklch, ${tone} 42%, transparent)` };
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
    const toneStyle = tone ? { background: `color-mix(in oklch, ${tone} 10%, transparent)`, borderColor: `color-mix(in oklch, ${tone} 35%, var(--border))` } : undefined;
    return <div className="rounded-lg border bg-foreground/[.04] p-3" style={toneStyle}><div className="text-xs text-foreground/50">{label}</div><div className="mt-1 text-sm font-semibold" style={tone ? { color: tone } : undefined}>{value}</div></div>;
}
