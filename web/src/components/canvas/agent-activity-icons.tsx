import type { ReactNode, SVGProps } from "react";

import type { AgentToolCategory } from "@/lib/canvas/agent-tool-presentation";

/**
 * Agent 活动流（思考 / 工具调用）专用图标。
 *
 * 统一 16px 网格、1.5 线宽、圆角端点，并给主体形状一层很淡的填充：在 12–14px 的
 * 显示尺寸下比 24px 网格缩放的通用图标更轻、更容易一眼分辨类别。
 * 颜色全部走 currentColor，由外层的类别色调决定。
 */
type GlyphProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: GlyphProps & { children: ReactNode }) {
    return (
        <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
            {children}
        </svg>
    );
}

const SOFT_FILL = { fill: "currentColor", fillOpacity: 0.16 } as const;

/** 思考：一大一小两颗四角星。 */
export function AgentThinkGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M7 2.5C7.45 5.6 8.4 6.55 11.5 7 8.4 7.45 7.45 8.4 7 11.5 6.55 8.4 5.6 7.45 2.5 7 5.6 6.55 6.55 5.6 7 2.5Z" {...SOFT_FILL} />
            <path d="M12.25 10.25C12.4 11.6 12.65 11.85 14 12 12.65 12.15 12.4 12.4 12.25 13.75 12.1 12.4 11.85 12.15 10.5 12 11.85 11.85 12.1 11.6 12.25 10.25Z" fill="currentColor" strokeWidth={1} />
        </Glyph>
    );
}

/** 读取清单：画布节点的 2×2 网格（只知道"有哪些"，没看画面）。 */
export function AgentInventoryGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.25" {...SOFT_FILL} />
            <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.25" />
            <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.25" />
            <rect x="9" y="9" width="4.5" height="4.5" rx="1.25" />
        </Glyph>
    );
}

/** 读取信息：带折角的文档。 */
export function AgentDocumentGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M9 2.5H4.75C4.06 2.5 3.5 3.06 3.5 3.75v8.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V6L9 2.5Z" {...SOFT_FILL} />
            <path d="M9 2.5V6h3.5M5.75 8.75h4.5M5.75 11h2.75" />
        </Glyph>
    );
}

/** 查看画面：眼睛，唯一真把图片交给模型的档位。 */
export function AgentVisionGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z" />
            <circle cx="8" cy="8" r="2.1" {...SOFT_FILL} fillOpacity={0.4} />
        </Glyph>
    );
}

/** 创建节点：圆角方块里的加号。 */
export function AgentCreateGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <rect x="2.5" y="2.5" width="11" height="11" rx="3" {...SOFT_FILL} />
            <path d="M8 5.5v5M5.5 8h5" />
        </Glyph>
    );
}

/** 修改画布：笔尖。 */
export function AgentEditGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M10.6 3.15a1.59 1.59 0 0 1 2.25 2.25L6.1 12.15 3 13l.85-3.1 6.75-6.75Z" {...SOFT_FILL} />
            <path d="M9.5 4.25l2.25 2.25" />
        </Glyph>
    );
}

/** 其他操作：中性的调节滑杆。 */
export function AgentOtherGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M2.75 5h4M10.75 5h2.5M2.75 11h1.5M8.25 11h5" />
            <circle cx="8.75" cy="5" r="1.75" {...SOFT_FILL} />
            <circle cx="6.25" cy="11" r="1.75" {...SOFT_FILL} />
        </Glyph>
    );
}

/** 自动纠正：顺时针回转箭头。 */
export function AgentRetryGlyph(props: GlyphProps) {
    return (
        <Glyph {...props}>
            <path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" />
            <path d="M13.25 2.5v2.75H10.5" />
        </Glyph>
    );
}

/** 展开指示：右向细箭头，展开时由 CSS 旋转 90°。 */
export function AgentChevronGlyph(props: GlyphProps) {
    return (
        <Glyph strokeWidth={1.6} {...props}>
            <path d="M6.25 4.25 10 8l-3.75 3.75" />
        </Glyph>
    );
}

/**
 * 类别 → 图标。`canvasInventory` 区分"读到画布清单"和"读到其他信息"，
 * 两者同属 read 类别，但用户需要一眼看出读的是画布还是外部信息。
 */
export function agentActivityGlyph(category: AgentToolCategory, options: { canvasInventory?: boolean; retry?: boolean } = {}) {
    if (options.retry) return <AgentRetryGlyph />;
    if (category === "vision") return <AgentVisionGlyph />;
    if (category === "read") return options.canvasInventory ? <AgentInventoryGlyph /> : <AgentDocumentGlyph />;
    if (category === "create") return <AgentCreateGlyph />;
    if (category === "operate") return <AgentEditGlyph />;
    return <AgentOtherGlyph />;
}
