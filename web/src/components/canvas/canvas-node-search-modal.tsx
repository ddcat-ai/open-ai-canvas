import { useMemo, useState } from "react";
import { Empty, Input, Modal } from "antd";
import { FileText, Image, Search, Video } from "lucide-react";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function CanvasNodeSearchModal({ open, nodes, onClose, onFocus }: { open: boolean; nodes: CanvasNodeData[]; onClose: () => void; onFocus: (nodeId: string) => void }) {
    const [query, setQuery] = useState("");
    const results = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return nodes.slice(0, 40);
        return nodes.filter((node) => [node.title, node.type, node.metadata?.prompt, node.metadata?.composerContent, node.metadata?.model, ...(node.metadata?.assetTags || [])]
            .some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(keyword))).slice(0, 80);
    }, [nodes, query]);

    return (
        <Modal title="搜索画布节点" open={open} footer={null} width="min(680px, 90vw)" onCancel={onClose} afterClose={() => setQuery("")} centered>
            <Input autoFocus allowClear value={query} onChange={(event) => setQuery(event.target.value)} prefix={<Search className="size-4 opacity-50" />} placeholder="搜索标题、提示词、模型或标签" />
            <div className="thin-scrollbar mt-3 max-h-[50vh] overflow-y-auto border-t pt-2">
                {results.length ? results.map((node) => (
                    <button
                        key={node.id}
                        type="button"
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => { onFocus(node.id); onClose(); }}
                    >
                        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                            {node.type === CanvasNodeType.Image ? <Image className="size-4" /> : node.type === CanvasNodeType.Video ? <Video className="size-4" /> : <FileText className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{node.title}</span>
                            <span className="block truncate text-xs opacity-55">{node.metadata?.prompt || node.metadata?.composerContent || node.type}</span>
                        </span>
                    </button>
                )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配节点" />}
            </div>
        </Modal>
    );
}
