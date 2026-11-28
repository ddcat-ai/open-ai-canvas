import { App, Button, Input, Modal, Progress, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { buildJimengCanvasNodes, collectJimengMediaResourceIds, parseJimengProjectId, type StoredJimengMedia } from "@/lib/canvas/jimeng-import";
import { importJimengCanvas, storedJimengMedia, storeJimengImportMedia, type JimengImportResult } from "@/services/api/jimeng";
import { transferJimengImportMedia } from "@/services/jimeng-import-media";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { CanvasImportSaveStatus } from "../canvas-import-save";

// 站点限额按分钟滚动，等待更久没有意义。
const MAX_RETRY_WAIT_SECONDS = 60;

type Props = {
    open: boolean;
    projectId: string;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    onClose: () => void;
    /** 读取前先把画布同步到云端；返回 false 表示尚未同步成功，不再继续。 */
    beforeImport?: () => Promise<boolean | void>;
    onApply: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => Promise<CanvasImportSaveStatus>;
};

type StoreProgress = { done: number; total: number; waitSeconds: number };

function formatExpiry(value?: string) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// 未转存素材的提示带上原因汇总，方便判断是该调高站点限额还是稍后重新导入。
function describeUnstored(count: number, failures: Map<string, string>) {
    const base = `${count} 个素材未能转存，仍在使用即梦临时链接（视频约 1 小时、图片约 20 天后失效）`;
    const counts = new Map<string, number>();
    for (const reason of failures.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const detail = [...counts].map(([reason, times]) => `${reason}（${times} 个）`).join("；");
    return detail ? `${base}：${detail}` : base;
}

export function JimengImportDialog({ open, projectId, viewport, viewportSize, onClose, beforeImport, onApply }: Props) {
    const { message } = App.useApp();
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<JimengImportResult | null>(null);
    const [progress, setProgress] = useState<StoreProgress | null>(null);
    const [saveStarted, setSaveStarted] = useState(false);
    const applyingRef = useRef(false);
    const stopStoringRef = useRef(false);
    const storeFinishedRef = useRef(false);
    const storedRef = useRef(new Map<string, StoredJimengMedia>());
    const failuresRef = useRef(new Map<string, string>());
    const jimengProjectId = useMemo(() => parseJimengProjectId(value), [value]);

    const reset = () => {
        setValue("");
        setResult(null);
        setProgress(null);
        setSaveStarted(false);
        applyingRef.current = false;
        stopStoringRef.current = false;
        storeFinishedRef.current = false;
        storedRef.current = new Map();
        failuresRef.current = new Map();
    };

    const close = () => {
        if (loading || progress) return;
        reset();
        onClose();
    };

    const changeValue = (nextValue: string) => {
        setValue(nextValue);
        setResult(null);
        setSaveStarted(false);
        storeFinishedRef.current = false;
        storedRef.current = new Map();
        failuresRef.current = new Map();
    };

    const load = async () => {
        if (!jimengProjectId) {
            message.error("请填写有效的即梦画布分享链接或画布 ID");
            return;
        }
        setLoading(true);
        try {
            // 服务端按画布归属放行读取，新建后尚未同步到云端的画布要先保存一次。
            if (beforeImport && (await beforeImport()) === false) return;
            setResult(await importJimengCanvas(projectId, jimengProjectId));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取即梦画布失败");
        } finally {
            setLoading(false);
        }
    };

    const waitForQuota = async (seconds: number, onTick: (remaining: number) => void) => {
        const until = Date.now() + Math.min(seconds, MAX_RETRY_WAIT_SECONDS) * 1000;
        while (!stopStoringRef.current) {
            const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
            if (!remaining) return;
            onTick(remaining);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    };

    // 即梦的媒体地址是短期签名链接（视频约一小时失效），写入画布前先逐批转存为影策资源。
    const storeMedia = async (canvas: JimengImportResult) => {
        const outcome = await transferJimengImportMedia({
            resourceIds: collectJimengMediaResourceIds(canvas),
            store: (resourceIds) => storeJimengImportMedia(projectId, canvas.projectId, resourceIds),
            toStoredMedia: storedJimengMedia,
            onProgress: setProgress,
            shouldStop: () => stopStoringRef.current,
            waitForQuota,
        });
        storedRef.current = outcome.stored;
        failuresRef.current = outcome.failures;
        setProgress(null);
    };

    const apply = async () => {
        if (!result || applyingRef.current) return;
        applyingRef.current = true;
        try {
            if (!storeFinishedRef.current) {
                await storeMedia(result);
                storeFinishedRef.current = true;
            }
            setSaveStarted(true);
            setLoading(true);
            const status = await onApply(buildJimengCanvasNodes(result, viewport, viewportSize, storedRef.current), result.connections);
            const unstored = collectJimengMediaResourceIds(result).filter((resourceId) => !storedRef.current.has(resourceId)).length;
            const failures = failuresRef.current;
            reset();
            onClose();
            const summary = `${result.importedNodeCount} 个节点和 ${result.importedConnectionCount} 条连接`;
            if (status === "pending") message.warning(`已在本机保存 ${summary}，正在后台同步`);
            else message.success(`已导入 ${summary}并保存到云端`);
            if (unstored) message.warning(describeUnstored(unstored, failures));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存导入结果失败");
        } finally {
            applyingRef.current = false;
            setLoading(false);
        }
    };

    const hasWarnings = result ? Boolean(result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.placeholderNodeCount || result.warnings.length) : false;
    const expiry = formatExpiry(result?.mediaExpiresAt);

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title="导入即梦画布"
            width={620}
            footer={
                progress ? (
                    <Button onClick={() => (stopStoringRef.current = true)}>停止转存，使用临时链接</Button>
                ) : result ? (
                    [
                        <Button key="close" onClick={close}>
                            关闭
                        </Button>,
                        <Button key="apply" type="primary" icon={<Import className="size-4" />} loading={loading} onClick={() => void apply()}>
                            {saveStarted ? "重试保存" : "确认导入"}
                        </Button>,
                    ]
                ) : (
                    <Button type="primary" loading={loading} onClick={() => void load()}>
                        读取画布
                    </Button>
                )
            }
        >
            <div className="space-y-4">
                <div>
                    <label className="mb-2 block text-sm font-medium">即梦画布分享链接或画布 ID</label>
                    <Input
                        value={value}
                        onChange={(event) => changeValue(event.target.value)}
                        placeholder="粘贴 https://jimeng.jianying.com/ai-tool/ai-canvas/…"
                        disabled={loading || Boolean(progress)}
                        suffix={jimengProjectId && value !== jimengProjectId ? <ExternalLink className="size-4 text-foreground/35" /> : null}
                    />
                </div>
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在读取即梦画布…
                    </div>
                ) : null}
                {progress ? (
                    <div className="space-y-2">
                        <Progress percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 100} size="small" status="active" />
                        <div className="text-sm text-foreground/60">
                            正在把素材转存到影策存储 {progress.done}/{progress.total}
                            {progress.waitSeconds ? ` · 已达站点每分钟转存上限，${progress.waitSeconds} 秒后继续` : ""}
                        </div>
                    </div>
                ) : null}
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{result.projectName || "即梦画布"}</div>
                                    <div className="mt-1 text-sm text-foreground/60">
                                        可导入 {result.importedNodeCount} 个节点 · {result.importedConnectionCount} 条连线
                                    </div>
                                </div>
                                <Tag color="blue">即梦</Tag>
                            </div>
                            <div className="mt-3 text-xs leading-5 text-foreground/50">
                                节点会保留相对位置和分组，并整体放到当前可视区域中心。即梦的素材地址是临时签名链接
                                {expiry ? `（最早于 ${expiry} 失效）` : ""}，确认导入后会先转存到影策存储。
                            </div>
                        </div>
                        {hasWarnings ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? <div>{result.skippedNodes.length} 个暂不支持的节点未导入，相关连线已自动忽略。</div> : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? <div>{result.skippedConnections.length} 条无效连线已自动忽略。</div> : null}
                                    {result.placeholderNodeCount ? <div>{result.placeholderNodeCount} 个素材不可用的节点已作为占位节点保留。</div> : null}
                                    {result.multiResultNodeCount ? <div>{result.multiResultNodeCount} 个保留了多批历史结果的节点已导入当前结果。</div> : null}
                                    {result.warnings.map((warning, index) => (
                                        <div key={`${warning.id || "warning"}-${index}`}>{warning.message}</div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {progress ? null : (
                            <div className="flex flex-wrap gap-2">
                                <Tag>{saveStarted ? "保存未完成，导入内容仍保留" : "等待确认导入"}</Tag>
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
