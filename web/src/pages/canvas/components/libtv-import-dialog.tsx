import { App, Button, Input, Modal, Tag } from "antd";
import { CircleAlert, ExternalLink, Import, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { buildLibTVImagePreviewUrl, formatLibTVBatchTime, parseLibTVProjectUUID } from "@/lib/canvas/libtv-import";
import { importLibTVCanvas, type LibTVImportResult } from "@/services/api/libtv";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { useTranslation } from "react-i18next";

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
            content: node.content,
            previewContent: node.type === "image" ? buildLibTVImagePreviewUrl(node.content) : undefined,
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
    const { t } = useTranslation("canvas");
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
            message.error(t("canvas:enter-a-libtv-canvas-uuid-or-link"));
            return;
        }
        setLoading(true);
        try {
            setResult(await importLibTVCanvas(projectId, uuid));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-read-libtv-canvas"));
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
            message.success(t("canvas:imported-param-nodes-and-param-connections", { importedNodeCount: result.importedNodeCount, importedConnectionCount: result.importedConnectionCount }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-save-import-result"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            className="workspace-modal"
            open={open}
            onCancel={close}
            title={t("canvas:import-libtv-canvas")}
            width={620}
            footer={
                result ? (
                    [
                        <Button key="close" onClick={close}>
                            {t("canvas:close-3")}
                        </Button>,
                        <Button key="apply" type="primary" icon={<Import className="size-4" />} loading={loading} onClick={() => void apply()}>
                            {t("canvas:confirm-import-2")}
                        </Button>,
                    ]
                ) : (
                    <Button type="primary" loading={loading} onClick={() => void load()}>
                        {t("canvas:read-canvas-2")}
                    </Button>
                )
            }
        >
            <div className="space-y-4">
                <div>
                    <label className="mb-2 block text-sm font-medium">{t("canvas:libtv-canvas-uuid-or-link")}</label>
                    <Input
                        value={value}
                        onChange={(event) => changeValue(event.target.value)}
                        placeholder={t("canvas:paste-a-32-character-uuid-canvas-link-or-share-link")}
                        disabled={loading}
                        suffix={uuid && value !== uuid ? <ExternalLink className="size-4 text-foreground/35" /> : null}
                    />
                </div>
                {loading && !result ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/55">
                        <LoaderCircle className="size-4 animate-spin" />
                        {t("canvas:reading-libtv-canvas")}
                    </div>
                ) : null}
                {result ? (
                    <div className="space-y-3">
                        <div className="rounded-xl p-4" style={{ background: "var(--library-surface)" }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">{result.projectName || t("canvas:libtv-canvas")}</div>
                                    <div className="mt-1 text-sm text-foreground/60">
                                        {t("canvas:importable-2")} {result.importedNodeCount} {t("canvas:nodes-3")} {result.importedConnectionCount} {t("canvas:connections-2")}
                                    </div>
                                </div>
                                <Tag color="blue">
                                    {t("canvas:batches-3")}
                                    {formatLibTVBatchTime(result.batchCreatedAt)}
                                </Tag>
                            </div>
                            <div className="mt-3 text-xs leading-5 text-foreground/50">{t("canvas:nodes-keep-their-relative-layout-and-are-centered-in-the-current-viewpor")}</div>
                        </div>
                        {result.skippedNodes.length || result.skippedConnections.length || result.multiResultNodeCount || result.staleNodeCount || result.reusedFailedNodeCount || result.placeholderNodeCount || result.convertedSpecialCount ? (
                            <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-foreground/60" style={{ background: "var(--surface-hover)" }}>
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    {result.skippedNodes.length ? (
                                        <div>
                                            {result.skippedNodes.length} {t("canvas:unsupported-node-types-were-skipped-their-connections-were-ignored-2")}
                                        </div>
                                    ) : null}
                                    {!result.skippedNodes.length && result.skippedConnections.length ? (
                                        <div>
                                            {result.skippedConnections.length} {t("canvas:invalid-connections-were-ignored-2")}
                                        </div>
                                    ) : null}
                                    {result.reusedFailedNodeCount ? (
                                        <div>
                                            {result.reusedFailedNodeCount} {t("canvas:nodes-with-failed-recent-tasks-kept-their-historical-results-2")}
                                        </div>
                                    ) : null}
                                    {result.placeholderNodeCount ? (
                                        <div>
                                            {result.placeholderNodeCount} {t("canvas:nodes-without-results-were-kept-as-placeholders-2")}
                                        </div>
                                    ) : null}
                                    {result.convertedSpecialCount ? (
                                        <div>
                                            {result.convertedSpecialCount} {t("canvas:special-nodes-were-converted-to-image-reference-nodes")}
                                        </div>
                                    ) : null}
                                    {result.multiResultNodeCount ? (
                                        <div>
                                            {result.multiResultNodeCount} {t("canvas:multi-result-nodes-use-their-first-result-2")}
                                        </div>
                                    ) : null}
                                    {result.staleNodeCount ? (
                                        <div>
                                            {result.staleNodeCount} {t("canvas:stale-flagged-nodes-keep-their-current-results")}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            <Tag>{t("canvas:waiting-for-import-confirmation-2")}</Tag>
                        </div>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
