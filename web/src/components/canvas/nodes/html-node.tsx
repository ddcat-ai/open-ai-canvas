import { Code } from "lucide-react";

import { useUpstreamNodes } from "@/components/canvas/canvas-node-graph-context";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

import { SandboxedFrame } from "./sandboxed-frame";

type HtmlNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

/**
 * HTML 展示节点：在沙箱 iframe 里预览 HTML。
 *
 * 源码取自身 metadata.content，为空时回落上游文本（与 SVG / Markdown 一致）。
 * 自身有源码时，上游文本作为数据填进 `{{input}}`，所以「模板 + 数据」两条线可以分开接。
 *
 * 脚本可执行（allow-scripts），但 SandboxedFrame 结构上不允许同时给 allow-same-origin
 * —— 否则页面能读到本源登录态。
 */
export function HtmlNodeContent({ node, theme }: HtmlNodeContentProps) {
    const upstream = useUpstreamNodes(node.id);
    const inherited = upstream.find((item) => getNodeResourceKind(item) === "text");
    const upstreamText = inherited?.metadata?.content || inherited?.metadata?.prompt || "";
    const own = node.metadata?.content || "";
    // 与 SVG / Markdown 一致：自身为空时把上游文本当源码，这样「AI 写页面 → 连线 → 看效果」
    // 不需要先把源码搬进本节点。
    const source = own || upstreamText;
    // 源码本身就来自上游时，{{input}} 没有第二份数据可填——替换成空串，
    // 否则会把同一段内容再塞回自己里。
    const input = own ? upstreamText : "";

    if (!source.trim()) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.muted }}>
                <Code className="size-5 opacity-60" />
                <span style={{ fontSize: "var(--fs-label)" }}>连接输出 HTML 的文本节点</span>
                <span style={{ fontSize: "var(--fs-tiny)" }}>源码里的 {"{{input}}"} 会替换为上游文本</span>
            </div>
        );
    }

    return <SandboxedFrame srcDoc={source.replaceAll("{{input}}", input)} theme={theme} allowScripts />;
}
