import { Building2, Camera, Clapperboard, Film, Globe2, Keyboard, Layers, ListTree, Map as MapIcon, Shapes, Trees, UserRound, Video, type LucideIcon } from "lucide-react";

/**
 * 世界引擎左侧悬浮工具条：按工作流分组「搭世界 → 拍戏 → 出片」，每个入口直达对应面板或添加页。
 * 只负责触发，不持有状态；激活态由工作台传入。
 */
export type PrevisWorldToolbarAction = "world" | "building" | "nature" | "base" | "layout" | "actor" | "camera" | "shot" | "animate" | "clay" | "depth" | "list" | "shortcuts";

type ToolbarItem = { action: PrevisWorldToolbarAction; label: string; icon: LucideIcon; hint: string };

const GROUPS: Array<{ title: string; items: ToolbarItem[] }> = [
    {
        title: "搭世界",
        items: [
            { action: "world", label: "天气", icon: Globe2, hint: "光照时刻、天气、远景与地面范围" },
            { action: "layout", label: "布景", icon: MapIcon, hint: "一键生成城池、街道、乡村、园林、森林" },
            { action: "building", label: "建筑", icon: Building2, hint: "可调层数和尺寸的楼房、古建、塔楼" },
            { action: "nature", label: "花木", icon: Trees, hint: "树木、花草、山石" },
            { action: "base", label: "组件", icon: Shapes, hint: "道路、墙体、地面、台阶、房间等基础组件，可批量排布" },
            { action: "actor", label: "角色", icon: UserRound, hint: "加入演员或群众" },
        ],
    },
    {
        title: "拍戏",
        items: [
            { action: "camera", label: "机位", icon: Camera, hint: "加入摄影机机位" },
            { action: "shot", label: "镜头", icon: Clapperboard, hint: "景别、焦段、运镜与镜头意图" },
            { action: "animate", label: "动画", icon: Film, hint: "走位、动作与关键帧时间轴" },
        ],
    },
    {
        title: "出片",
        items: [
            { action: "clay", label: "白膜", icon: Video, hint: "按镜头时长导出白膜视频" },
            { action: "depth", label: "深度", icon: Layers, hint: "导出深度图与深度视频" },
        ],
    },
];

export function PrevisWorldToolbar({ active, busy, onAction }: { active: Partial<Record<PrevisWorldToolbarAction, boolean>>; busy?: boolean; onAction: (action: PrevisWorldToolbarAction) => void }) {
    return (
        <nav className="pv-world-toolbar" aria-label="世界引擎工具" data-canvas-no-zoom>
            {GROUPS.map((group) => (
                <div key={group.title} className="pv-world-toolbar__group" role="group" aria-label={group.title}>
                    <span className="pv-world-toolbar__title">{group.title}</span>
                    {group.items.map((item) => (
                        <button
                            key={item.action}
                            type="button"
                            className={`pv-world-toolbar__item ${active[item.action] ? "is-active" : ""}`}
                            aria-pressed={active[item.action] ? true : undefined}
                            title={item.hint}
                            disabled={busy && (item.action === "clay" || item.action === "depth")}
                            onClick={() => onAction(item.action)}
                        >
                            <item.icon className="size-[18px]" aria-hidden />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            ))}
            <div className="pv-world-toolbar__group pv-world-toolbar__group--footer" role="group" aria-label="视图">
                <button type="button" className={`pv-world-toolbar__item is-compact ${active.list ? "is-active" : ""}`} aria-label="场景对象列表" aria-pressed={Boolean(active.list)} title="场景对象列表" onClick={() => onAction("list")}>
                    <ListTree className="size-4" aria-hidden />
                </button>
                <button type="button" className={`pv-world-toolbar__item is-compact ${active.shortcuts ? "is-active" : ""}`} aria-pressed={Boolean(active.shortcuts)} title="快捷键" onClick={() => onAction("shortcuts")}>
                    <Keyboard className="size-4" aria-hidden />
                </button>
            </div>
        </nav>
    );
}
