import type { CanvasTheme } from "@/lib/canvas-theme";

type SandboxedFrameProps = {
    /** 完整的 HTML 文档字符串，作为 iframe 的 srcDoc */
    srcDoc: string;
    theme: CanvasTheme;
    /**
     * 是否允许文档内脚本执行。
     *
     * ⚠️ 只给 allow-scripts，**绝不同时给 allow-same-origin** —— 两者并存等于取消沙箱：
     * 文档能拿到本源 DOM 与存储（含登录态）。这里刻意不暴露 sandbox 的完整取值，
     * 就是为了让这条约束没有被绕过的入口。
     */
    allowScripts?: boolean;
};

/**
 * 沙箱 iframe —— SVG 与 HTML 节点共用。
 *
 * 依赖里没有 DOMPurify，手写消毒不可靠（script / on* / foreignObject 等绕法很多），
 * 所以两种节点都不走 innerHTML，统一塞进沙箱 iframe 渲染。
 */
export function SandboxedFrame({ srcDoc, theme, allowScripts = false }: SandboxedFrameProps) {
    return (
        <iframe
            title="节点预览"
            className="h-full w-full border-0"
            sandbox={allowScripts ? "allow-scripts" : ""}
            srcDoc={srcDoc}
            data-canvas-no-zoom
            style={{ background: theme.node.fill }}
            // 指针交给文档自己处理，但按下时别让画布把它当成拖拽节点。
            onMouseDown={(event) => event.stopPropagation()}
        />
    );
}

/** 把一段片段包成可渲染的最小文档；居中且不溢出节点。 */
export function centeredFrameDocument(body: string, extraCss = "") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}body{display:grid;place-items:center;overflow:hidden}svg,img{max-width:100%;max-height:100%}${extraCss}</style></head><body>${body}</body></html>`;
}
