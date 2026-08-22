import { FileText } from "lucide-react";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

type MarkdownNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * Markdown 展示节点。
 *
 * 内容取自身 metadata.content；为空时回落到上游文本素材——这样「AI 写文档 → 连一根线 →
 * 排版好的文档」不需要先把内容搬进本节点。上游取用统一经 CanvasNodeGraphContext，
 * 判定文本素材复用注册表的 resourceKind，不在这里另立一套判断。
 */
export function MarkdownNodeContent({ node, theme }: MarkdownNodeContentProps) {
    const upstream = useUpstreamNodes(node.id);
    const own = node.metadata?.content || "";
    const inherited = upstream.find((item) => getNodeResourceKind(item) === "text");
    const source = own || inherited?.metadata?.content || inherited?.metadata?.prompt || "";

    if (!source.trim()) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <FileText className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>连接文本节点，或双击编辑 Markdown</span>
            </div>
        );
    }

    return (
        // 滚动区要吞掉 wheel 并标 data-canvas-no-zoom，否则滚动会被画布缩放拦走。
        <div
            className="h-full w-full overflow-y-auto overflow-x-hidden px-4 py-3"
            data-canvas-no-zoom
            style={{ color: theme.node.text }}
            onWheel={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            <AIMessageMarkdown>{source}</AIMessageMarkdown>
        </div>
    );
}
