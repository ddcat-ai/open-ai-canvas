import { useMemo, useState } from "react";
import { Input, Modal } from "antd";
import { BookOpenText, FileText, Image, Pencil, Search, Video } from "lucide-react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { getNodeListLabel } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { useTranslation } from "react-i18next";

export function CanvasNodeSearchModal({ open, nodes, onClose, onFocus }: { open: boolean; nodes: CanvasNodeData[]; onClose: () => void; onFocus: (nodeId: string) => void }) {
    const { t } = useTranslation("canvas");
    const [query, setQuery] = useState("");
    const results = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return nodes.slice(0, 40);
        return nodes
            .filter((node) =>
                [
                    node.title,
                    node.type,
                    getNodeListLabel(node.type),
                    node.metadata?.prompt,
                    node.metadata?.composerContent,
                    node.metadata?.model,
                    node.metadata?.chapterTitle,
                    node.metadata?.workflowTitle,
                    node.metadata?.workflowDescription,
                    typeof node.metadata?.shotIndex === "number" ? t("canvas:shot-param", { shotIndex: node.metadata.shotIndex + 1 }) : "",
                    ...(node.metadata?.assetTags || []),
                ].some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(keyword)),
            )
            .slice(0, 80);
    }, [nodes, query, t]);

    return (
        <Modal title={t("canvas:search-canvas-nodes")} open={open} footer={null} width="min(680px, 90vw)" onCancel={onClose} afterClose={() => setQuery("")} centered>
            <Input autoFocus allowClear value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search className="size-4 opacity-50" />} placeholder={t("domain:search-nodes-chapters-shots-models-or-tags")} />
            <div className="thin-scrollbar mt-3 max-h-[50vh] overflow-y-auto border-t pt-2">
                {results.length ? (
                    results.map((node) => (
                        <button
                            key={node.id}
                            type="button"
                            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={() => {
                                onFocus(node.id);
                                onClose();
                            }}
                        >
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                                {node.type === CanvasNodeType.Image ? (
                                    <Image className="size-4" />
                                ) : node.type === CanvasNodeType.Video ? (
                                    <Video className="size-4" />
                                ) : node.type === CanvasNodeType.Drawing ? (
                                    <Pencil className="size-4" />
                                ) : (
                                    <FileText className="size-4" />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{node.title}</span>
                                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs opacity-55">
                                    {node.metadata?.chapterTitle ? <BookOpenText className="size-3 shrink-0" /> : null}
                                    <span className="truncate">{nodeContextLabel(node, t)}</span>
                                </span>
                            </span>
                        </button>
                    ))
                ) : (
                    <WorkspaceState icon="canvas" compact title={t("domain:no-matching-nodes")} description={t("domain:try-another-node-chapter-shot-model-or-tag")} />
                )}
            </div>
        </Modal>
    );
}

function nodeContextLabel(node: CanvasNodeData, t: (key: string, options?: Record<string, unknown>) => string) {
    const location = [node.metadata?.chapterTitle, typeof node.metadata?.shotIndex === "number" ? t("canvas:shot-param", { shotIndex: node.metadata.shotIndex + 1 }) : ""].filter(Boolean).join(" · ");
    return location || node.metadata?.prompt || node.metadata?.composerContent || node.metadata?.workflowDescription || getNodeListLabel(node.type);
}
