import { App, Button, Input, Modal, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { buildLibTVImagePreviewUrl, buildLibTVVideoPreviewUrl, buildLibTVVideoSourceUrl, formatLibTVBatchTime, parseLibTVProjectUUID } from "@/lib/canvas/libtv-import";
import { importLibTVCanvas, type LibTVImportResult } from "@/services/api/libtv";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

type Props = {
    open: boolean;
    projectId: string;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    onClose: () => void;
    onApply: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => Promise<void>;
};

function buildCanvasNodes(result: LibTVImportResult, viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    const minX = Math.min(...result.nodes.map((node) => node.x));
    const minY = Math.min(...result.nodes.map((node) => node.y));
    const maxX = Math.max(...result.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...result.nodes.map((node) => node.y + node.height));
    const offsetX = (viewportSize.width / 2 - viewport.x) / viewport.k - (minX + maxX) / 2;
    const offsetY = (viewportSize.height / 2 - viewport.y) / viewport.k - (minY + maxY) / 2;
    return result.nodes.map<CanvasNodeData>((node) => ({
        id: node.id,
        type: node.type === "video" ? CanvasNodeType.Video : CanvasNodeType.Image,
        title: node.title,
        position: { x: node.x + offsetX, y: node.y + offsetY },
        width: node.width,
        height: node.height,
        metadata: {
            content: node.type === "video" ? buildLibTVVideoSourceUrl(node.content) : node.content,
            previewContent: node.type === "image" ? buildLibTVImagePreviewUrl(node.content) : buildLibTVVideoPreviewUrl(node.content) || undefined,
            prompt: node.prompt,
            model: node.model,
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

export function LibTVImportDialog({ open, projectId, viewport, viewportSize, onClose, onApply }: Props) {
    const { message } = App.useApp();
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<LibTVImportResult | null>(null);
    const uuid = useMemo(() => parseLibTVProjectUUID(value), [value]);

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
        if (!uuid) {
            message.error("请填写 LibTV 画布 UUID 或链接");
            return;
        }
        setLoading(true);
        try {
            setResult(await importLibTVCanvas(projectId, uuid));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 LibTV 画布失败");
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

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title="导入 LibTV 画布"
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
                    <label className="mb-2 block text-sm font-medium">LibTV 画布 UUID 或链接</label>
                    <Input
                        value={value}
                        onChange={(event) => changeValue(event.target.value)}
                        placeholder="粘贴 32 位 UUID、画布链接或分享链接"
                        disabled={loading}
                        suffix={uuid && value !== uuid ? <ExternalLink className="size-4 text-foreground/35" /> : null}
                    />
                </div>
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                        正在读取 LibTV 画布…
                    </div>
                ) : null}
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{result.projectName || "LibTV 画布"}</div>
                                    <div className="mt-1 text-sm text-foreground/60">可导入 {result.importedNodeCount} 个节点 · {result.importedConnectionCount} 条连线</div>
                                </div>
                                <Tag color="blue">批次：{formatLibTVBatchTime(result.batchCreatedAt)}</Tag>
                            </div>
                            <div className="mt-3 text-xs leading-5 text-foreground/50">节点会保留相对位置，并整体放到当前可视区域中心。</div>
                        </div>
                        {result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.staleNodeCount || result.reusedFailedNodeCount || result.placeholderNodeCount || result.convertedSpecialCount ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? <div>{result.skippedNodes.length} 个暂不支持的节点未导入，相关连线已自动忽略。</div> : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? <div>{result.skippedConnections.length} 条无效连线已自动忽略。</div> : null}
                                    {result.reusedFailedNodeCount ? <div>{result.reusedFailedNodeCount} 个最近任务失败但仍有历史结果的节点已保留。</div> : null}
                                    {result.placeholderNodeCount ? <div>{result.placeholderNodeCount} 个尚未生成结果的节点已作为占位节点保留。</div> : null}
                                    {result.convertedSpecialCount ? <div>{result.convertedSpecialCount} 个特殊节点已转换为图片参考节点。</div> : null}
                                    {result.multiResultNodeCount ? <div>{result.multiResultNodeCount} 个多结果节点已使用首个结果。</div> : null}
                                    {result.staleNodeCount ? <div>{result.staleNodeCount} 个过期标记节点仍保留现有结果。</div> : null}
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
