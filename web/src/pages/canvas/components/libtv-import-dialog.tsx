import { App, Button, Input, Modal, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildLibTVCanvasNodes, formatLibTVBatchTime, parseLibTVProjectUUID, summarizeLibTVImportWarnings } from "@/lib/canvas/libtv-import";
import { createLatestRequestGuard } from "@/lib/libtv-gallery";
import { importLibTVCanvas, importLibTVTemplate, type LibTVImportResult } from "@/services/api/libtv";
import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

type Props = {
    open: boolean;
    projectId: string;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    onClose: () => void;
    onApply: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => Promise<void>;
    /** 模板模式：使用 importLibTVTemplate，支持 frame/text/audio，坐标已绝对化。 */
    templateUuid?: string;
};

export function LibTVImportDialog({ open, projectId, viewport, viewportSize, onClose, onApply, templateUuid }: Props) {
    const { message } = App.useApp();
    const [value, setValue] = useState("");
    const [loading, setLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<LibTVImportResult | null>(null);
    const requestGuardRef = useRef(createLatestRequestGuard());
    const autoLoadedKeyRef = useRef("");
    const templateMode = Boolean(templateUuid);
    const uuid = useMemo(() => templateUuid || parseLibTVProjectUUID(value), [templateUuid, value]);
    const warningGroups = summarizeLibTVImportWarnings(result?.warnings ?? []);

    // 切换画布或模板、卸载时作废在途读取，旧响应不能写进新的预览。
    useEffect(() => {
        const guard = requestGuardRef.current;
        setResult(null);
        setLoading(false);
        return () => guard.invalidate();
    }, [projectId, templateUuid]);

    const reset = () => {
        requestGuardRef.current.invalidate();
        autoLoadedKeyRef.current = "";
        setValue("");
        setResult(null);
        setLoading(false);
    };

    const close = () => {
        if (applying) return;
        reset();
        onClose();
    };

    const changeValue = (nextValue: string) => {
        requestGuardRef.current.invalidate();
        setValue(nextValue);
        setResult(null);
        setLoading(false);
    };

    const load = async () => {
        if (!uuid) {
            message.error(templateMode ? "模板 UUID 无效" : "请填写有效的 32 位 UUID 或链接");
            return;
        }
        const guard = requestGuardRef.current;
        const token = guard.begin();
        setLoading(true);
        try {
            const loadedResult = templateMode ? await importLibTVTemplate(projectId, uuid) : await importLibTVCanvas(projectId, uuid);
            if (!guard.isCurrent(token)) return;
            setResult(loadedResult);
        } catch (error) {
            if (!guard.isCurrent(token)) return;
            message.error(error instanceof Error ? error.message : templateMode ? "读取模板失败" : "读取 LibTV 画布失败");
        } finally {
            if (guard.isCurrent(token)) setLoading(false);
        }
    };

    // 模板模式打开后自动读取一次；失败后由用户点击按钮手动重试，不自动循环。
    useEffect(() => {
        if (!templateMode || !open || !uuid || result || loading) return;
        const key = `${projectId}:${uuid}`;
        if (autoLoadedKeyRef.current === key) return;
        autoLoadedKeyRef.current = key;
        void load();
    });

    const apply = async () => {
        if (!result || applying) return;
        setApplying(true);
        try {
            await onApply(buildLibTVCanvasNodes(result.nodes, viewport, viewportSize), result.connections);
            reset();
            onClose();
            message.success(`已导入 ${result.importedNodeCount} 个节点和 ${result.importedConnectionCount} 条连接`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存导入结果失败");
        } finally {
            setApplying(false);
        }
    };

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title={templateMode ? "复制到画布" : "导入 LibTV 画布"}
            width={620}
            footer={
                result ? (
                    [
                        <Button key="close" onClick={close} disabled={applying}>
                            关闭
                        </Button>,
                        <Button key="apply" type="primary" icon={<Import className="size-4" />} loading={applying} onClick={() => void apply()}>
                            确认导入
                        </Button>,
                    ]
                ) : (
                    <Button type="primary" loading={loading} onClick={() => void load()} disabled={!uuid && !templateMode}>
                        读取画布
                    </Button>
                )
            }
        >
            <div className="space-y-4">
                {!templateMode && (
                    <div>
                        <label className="mb-2 block text-sm font-medium">LibTV 画布 UUID 或链接</label>
                        <Input
                            value={value}
                            onChange={(e) => changeValue(e.target.value)}
                            placeholder="请输入 32 位 UUID 或完整链接"
                            disabled={loading}
                        />
                    </div>
                )}
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                        {templateMode ? "正在读取模板…" : "正在读取 LibTV 画布…"}
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
                        {warningGroups.length > 0 && (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {warningGroups.map((warning) => (
                                        <div key={warning.message}>
                                            {warning.message}{warning.count > 1 ? `（${warning.count} 处）` : ""}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.staleNodeCount || result.reusedFailedNodeCount || result.placeholderNodeCount || result.convertedSpecialCount ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? <div>{result.skippedNodes.length} 个暂不支持的节点未导入，相关连线已自动忽略。</div> : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? <div>{result.skippedConnections.length} 条无效连线已自动忽略。</div> : null}
                                    {result.reusedFailedNodeCount ? <div>{result.reusedFailedNodeCount} 个最近任务失败但仍有历史结果的节点已保留。</div> : null}
                                    {result.placeholderNodeCount ? <div>{result.placeholderNodeCount} 个尚未生成结果的节点已作为占位节点保留。</div> : null}
                                    {result.convertedSpecialCount ? <div>{result.convertedSpecialCount} 个特殊节点（画框、音频等）已保留结构。</div> : null}
                                    {result.nodes.some((node) => (node.results?.length || 0) > 1) ? <div>{result.nodes.filter((node) => (node.results?.length || 0) > 1).length} 个多结果节点将以卡组保留全部有效结果。</div> : null}
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
