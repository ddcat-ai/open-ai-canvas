import { Dropdown, type MenuProps } from "antd";
import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { commerceArrangeMinimum, type CommerceArrangeKind } from "./canvas-arrange";

export type CommerceArrangeAction = CommerceArrangeKind | "reset";

const arrangeGroups: Array<{ label: string; items: Array<{ action: CommerceArrangeKind; label: string }> }> = [
    {
        label: "对齐",
        items: [
            { action: "align-left", label: "左对齐" },
            { action: "align-center", label: "水平居中" },
            { action: "align-right", label: "右对齐" },
            { action: "align-top", label: "顶部对齐" },
            { action: "align-middle", label: "垂直居中" },
            { action: "align-bottom", label: "底部对齐" },
        ],
    },
    {
        label: "分布",
        items: [
            { action: "distribute-horizontal", label: "水平等距" },
            { action: "distribute-vertical", label: "垂直等距" },
        ],
    },
    {
        label: "排列",
        items: [
            { action: "grid", label: "网格排列" },
            { action: "masonry", label: "瀑布流排列" },
            { action: "row", label: "横向排成一行" },
            { action: "column", label: "纵向排成一列" },
        ],
    },
];

const EDGE = 12;
const GAP = 12;
const TOP_SAFE = 70;
const BOTTOM_SAFE = 96;

/**
 * 多选图片时悬浮在选区上方的“对齐排布”按钮，点击展开纯文字菜单。
 * 上方空间不足时移到选区下方，水平方向避开左侧 Agent 面板并限制在画布内。
 */
export function CommerceArrangeMenu({
    bounds,
    frame,
    leftInset,
    count,
    onArrange,
}: {
    bounds: { x: number; y: number; width: number; height: number };
    frame: { width: number; height: number };
    leftInset: number;
    count: number;
    onArrange: (action: CommerceArrangeAction) => void;
}) {
    const bar = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 120, height: 34 });
    useLayoutEffect(() => {
        const element = bar.current;
        if (element && (element.offsetWidth !== size.width || element.offsetHeight !== size.height)) setSize({ width: element.offsetWidth, height: element.offsetHeight });
    });
    const half = size.width / 2;
    const minCenter = leftInset + EDGE + half;
    const maxCenter = frame.width - EDGE - half;
    const center = minCenter > maxCenter ? (leftInset + frame.width) / 2 : Math.min(maxCenter, Math.max(minCenter, bounds.x + bounds.width / 2));
    const above = bounds.y - GAP - size.height;
    const below = bounds.y + bounds.height + GAP;
    const top = above >= TOP_SAFE ? above : below + size.height <= frame.height - BOTTOM_SAFE ? below : TOP_SAFE;
    const items: MenuProps["items"] = [
        ...arrangeGroups.map((group) => ({
            type: "group" as const,
            key: group.label,
            label: group.label,
            children: group.items.map(({ action, label }) => {
                const minimum = commerceArrangeMinimum(action);
                return { key: action, label: count < minimum ? `${label}（至少 ${minimum} 张）` : label, disabled: count < minimum };
            }),
        })),
        { type: "divider" as const },
        { key: "reset", label: "恢复默认位置" },
    ];
    return (
        <div ref={bar} className="commerce-arrange-bar" data-canvas-no-zoom style={{ left: center, top }}>
            <Dropdown trigger={["click"]} placement="bottom" menu={{ items, onClick: ({ key }) => onArrange(key as CommerceArrangeAction) }}>
                <button type="button" aria-haspopup="menu" aria-label={`对齐排布已选的 ${count} 张图片`}>
                    对齐排布
                    <ChevronDown size={13} aria-hidden="true" />
                </button>
            </Dropdown>
        </div>
    );
}
