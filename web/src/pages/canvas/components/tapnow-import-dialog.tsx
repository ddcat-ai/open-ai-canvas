import { App, Button, Input, Modal, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { formatTapNowBatchTime, parseTapNowShareID } from "@/lib/canvas/tapnow-import";
import { importTapNowCanvas, type TapNowImportResult } from "@/services/api/tapnow";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

type Props = {
    open: boolean;
    projectId: string;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    onClose: () => void;
    onApply: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => Promise<void>;
};

function buildCanvasNodes(result: TapNowImportResult, viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    const minX = Math.min(...result.nodes.map((node) => node.x));
    const minY = Math.min(...result.nodes.map((node) => node.y));
    const maxX = Math.max(...result.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...result.nodes.map((node) => node.y + node.height));
    const offsetX = (viewportSize.width / 2 - viewport.x) / viewport.k - (minX + maxX) / 2;
    const offsetY = (viewportSize.height / 2 - viewport.y) / viewport.k - (minY + maxY) / 2;
    return result.nodes.map<CanvasNodeData>((node) => ({
        id: node.id,
        type: node.type === "video" ? CanvasNodeType.Video : node.type === "audio" ? CanvasNodeType.Audio : node.type === "text" ? CanvasNodeType.Text : CanvasNodeType.Image,
        title: node.title,
        position: { x: node.x + offsetX, y: node.y + offsetY },
        width: node.width,
        height: node.height,
        metadata: {
            content: node.content,
            prompt: node.prompt,
            model: node.model,
            size: node.size,
            quality: node.quality,
            seconds: node.seconds,
            vquality: node.vquality,
            generateAudio: node.generateAudio,
            status: node.status || "idle",
            errorDetails: node.errorDetails,
            naturalWidth: node.naturalWidth,
            naturalHeight: node.naturalHeight,
            durationMs: node.durationMs,
            mimeType: node.mimeType,
            importSource: node.metadata,
        },
    }));
}

export function TapNowImportDialog({ open, projectId, viewport, viewportSize, onClose, onApply }: Props) {
    const { message } = App.useApp();
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TapNowImportResult | null>(null);
    const shareID = useMemo(() => parseTapNowShareID(value), [value]);

    const reset = () => {
        setValue("");
        setResult(null);
    };

    const close = () => {
        if (loading) return;
        reset();
        onClose();
    };

    const changeValue = (nextValue: string) => {
        setValue(nextValue);
        setResult(null);
    };

    const load = async () => {
        if (!shareID) {
            message.error("请填写有效的 TapNow 画布分享链接或分享 ID");
            return;
        }
        setLoading(true);
        try {
            setResult(await importTapNowCanvas(projectId, shareID));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 TapNow 画布失败");
        } finally {
            setLoading(false);
        }
    };

    const apply = async () => {
        if (!result) return;
        setLoading(true);
        try {
            await onApply(buildCanvasNodes(result, viewport, viewportSize), result.connections);
            reset();
            onClose();
            message.success(`已导入 ${result.importedNodeCount} 个节点和 ${result.importedConnectionCount} 条连接`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存导入结果失败");
        } finally {
            setLoading(false);
        }
    };

    const hasWarnings = result ? Boolean(result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.reusedFailedNodeCount || result.placeholderNodeCount || result.warnings.length) : false;

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title="导入 TapNow 画布"
            width={620}
            footer={
                result ? (
                    [
                        <Button key="close" onClick={close}>
                            关闭
                        </Button>,
                        <Button key="apply" type="primary" icon={<Import className="size-4" />} loading={loading} onClick={() => void apply()}>
                            确认导入
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
                    <label className="mb-2 block text-sm font-medium">TapNow 画布分享链接或分享 ID</label>
                    <Input
                        value={value}
                        onChange={(event) => changeValue(event.target.value)}
                        placeholder="粘贴 https://app.tapnow.media/tapflow/view/…"
                        disabled={loading}
                        suffix={shareID && value !== shareID ? <ExternalLink className="size-4 text-foreground/35" /> : null}
                    />
                </div>
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在读取 TapNow 画布…
                    </div>
                ) : null}
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{result.projectName || "TapNow 画布"}</div>
                                    <div className="mt-1 text-sm text-foreground/60">
                                        可导入 {result.importedNodeCount} 个节点 · {result.importedConnectionCount} 条连线
                                    </div>
                                </div>
                                <Tag color="blue">批次：{formatTapNowBatchTime(result.batchCreatedAt)}</Tag>
                            </div>
                            <div className="mt-3 text-xs leading-5 text-foreground/50">支持图片、视频、音频和文本节点；节点会保留相对位置，并整体放到当前可视区域中心。</div>
                        </div>
                        {hasWarnings ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? <div>{result.skippedNodes.length} 个暂不支持的节点未导入，相关连线已自动忽略。</div> : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? <div>{result.skippedConnections.length} 条无效连线已自动忽略。</div> : null}
                                    {result.reusedFailedNodeCount ? <div>{result.reusedFailedNodeCount} 个最近任务失败但仍有历史结果的节点已保留。</div> : null}
                                    {result.placeholderNodeCount ? <div>{result.placeholderNodeCount} 个尚未生成结果的节点已作为占位节点保留。</div> : null}
                                    {result.multiResultNodeCount ? <div>{result.multiResultNodeCount} 个多结果节点已使用首个结果。</div> : null}
                                    {result.warnings.map((warning, index) => (
                                        <div key={`${warning.id || "warning"}-${index}`}>{warning.message}</div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            <Tag>等待确认导入</Tag>
                        </div>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
