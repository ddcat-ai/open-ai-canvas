import { Button, Switch, Tooltip } from "antd";
import { BookOpenCheck, BookOpenText, Bot, Clapperboard, Focus, Globe2, History, LayoutTemplate, Laptop, PanelRightClose, PanelsTopLeft, Plus, RotateCcw, Workflow } from "lucide-react";
import { useNavigate } from "react-router";

import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasAgentMode } from "./canvas-agent-chat-ui";

export function AgentPanelChrome({
    theme,
    mode,
    context,
    referenceCount,
    confirmTools,
    canUndo,
    undoCount,
    onModeChange,
    onConfirmToolsChange,
    onUndo,
    onCollapse,
    historyCount = 0,
    historyActive = false,
    onOpenHistory,
    onNewChat,
    newChatDisabled = false,
}: {
    theme: CanvasTheme;
    mode: CanvasAgentMode;
    context: CanvasContextSummary;
    referenceCount: number;
    confirmTools: boolean;
    canUndo: boolean;
    undoCount: number;
    onModeChange: (mode: CanvasAgentMode) => void;
    onConfirmToolsChange: (confirm: boolean) => void;
    onUndo: () => void;
    onCollapse: () => void;
    historyCount?: number;
    historyActive?: boolean;
    onOpenHistory?: () => void;
    onNewChat?: () => void;
    newChatDisabled?: boolean;
}) {
    const navigate = useNavigate();

    return (
        <header className="shrink-0 px-3 pb-1.5 pt-2.5">
            <div className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                    <Bot className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                        <div className="truncate text-sm font-semibold leading-5">Agent</div>
                        <span className="truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }}>画布协作</span>
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <Tooltip title="技能库">
                        <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" style={{ color: theme.node.muted }} icon={<BookOpenCheck className="size-3.5" />} onClick={() => navigate("/skills")} aria-label="打开技能库" />
                    </Tooltip>
                    {onOpenHistory ? (
                        <Tooltip title={historyCount ? `历史会话 · ${historyCount}` : "历史会话"}>
                            <Button type="text" className={`!h-7 !min-w-7 !px-1.5 ${historyActive ? "font-medium" : ""}`} style={{ color: historyActive ? theme.node.text : theme.node.muted, background: historyActive ? theme.spatial.surface : "transparent" }} icon={<History className="size-3.5" />} onClick={onOpenHistory} aria-label="打开历史会话">
                                {historyCount ? <span className="text-[var(--fs-tiny)] tabular-nums">{historyCount}</span> : null}
                            </Button>
                        </Tooltip>
                    ) : null}
                    {onNewChat ? (
                        <Tooltip title="新对话">
                            <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" disabled={newChatDisabled} style={{ color: theme.node.muted }} icon={<Plus className="size-3.5" />} onClick={onNewChat} aria-label="新建对话" />
                        </Tooltip>
                    ) : null}
                    <Tooltip title="收起 Agent">
                        <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-3.5" />} onClick={onCollapse} aria-label="收起 Agent" />
                    </Tooltip>
                </div>
            </div>

            <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                <span className="font-medium" style={{ color: theme.node.text }}>{context.nodeCount} 个节点</span>
                {context.selectedCount ? <span className="inline-flex items-center gap-1"><Focus className="size-3" />选中 {context.selectedCount}</span> : <span>未选择节点</span>}
                {context.chapterLabel ? <span className="inline-flex min-w-0 items-center gap-1"><BookOpenText className="size-3 shrink-0" /><span className="max-w-32 truncate">{context.chapterLabel}{context.shotLabel ? ` · ${context.shotLabel}` : ""}</span></span> : null}
                {referenceCount ? <span>{referenceCount} 个参考</span> : null}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <AgentModeSwitch value={mode} theme={theme} onChange={onModeChange} />
                    <Tooltip title={undoCount ? `撤销最近一批 Agent 写回，可撤销 ${undoCount} 批` : "没有可撤销的 Agent 写回"}>
                        <Button type="text" shape="circle" className="!h-6 !w-6 !min-w-6" disabled={!canUndo} style={{ color: theme.node.muted }} icon={<RotateCcw className="size-3" />} onClick={onUndo} aria-label="撤销最近一批 Agent 写回" />
                    </Tooltip>
                    <label className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-1" style={{ color: theme.node.muted }}>
                        <Switch size="small" checked={confirmTools} onChange={onConfirmToolsChange} />
                        <span className="whitespace-nowrap">确认</span>
                    </label>
                </div>
            </div>
        </header>
    );
}

function AgentModeSwitch({ value, theme, onChange }: { value: CanvasAgentMode; theme: CanvasTheme; onChange: (value: CanvasAgentMode) => void }) {
    return (
        <div className="inline-flex h-7 shrink-0 items-center rounded-full p-0.5 text-[var(--fs-label)]" style={{ background: `${theme.node.text}08`, boxShadow: `inset 0 1px 0 ${theme.node.text}08` }} role="group" aria-label="Agent 运行位置">
            {(["online", "local"] as const).map((item) => {
                const active = value === item;
                const Icon = item === "online" ? Globe2 : Laptop;
                return (
                    <button key={item} type="button" className="inline-flex h-6 items-center gap-1 rounded-full px-2 transition-[background-color,color,transform] duration-200 active:scale-95" style={{ background: active ? theme.node.fill : "transparent", color: active ? theme.node.text : theme.node.muted, boxShadow: active ? `0 4px 12px ${theme.spatial.shadow}` : "none" }} onClick={() => onChange(item)} aria-pressed={active}>
                        <Icon className="size-3" />
                        {item === "online" ? "网站" : "本机"}
                    </button>
                );
            })}
        </div>
    );
}

const starterActions = [
    { label: "搭建短剧工作流", icon: Clapperboard },
    { label: "整理当前画布", icon: LayoutTemplate },
    { label: "生成镜头分镜", icon: PanelsTopLeft },
    { label: "检查节点连线", icon: Workflow },
];

export function AgentChatEmptyState({ theme, nodeCount, onSelect }: { theme: CanvasTheme; nodeCount: number; onSelect: (value: string) => void }) {
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const visibleStarterActions = shortDramaEnabled ? starterActions : starterActions.filter((item) => item.label !== "搭建短剧工作流");
    return (
        <div className="flex h-full items-center px-5 py-8">
            <div className="mx-auto w-full max-w-[380px]">
                <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-md" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}><Bot className="size-3.5" /></span>
                    <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.muted }}>{nodeCount} 个节点已就绪</span>
                </div>
                <h2 className="mt-3 text-[var(--fs-heading-lg)] font-semibold leading-6" style={{ color: theme.node.text }}>从当前画布开始</h2>
                <div className="mt-4 grid grid-cols-1 gap-1">
                    {visibleStarterActions.map(({ label, icon: Icon }) => (
                        <button key={label} type="button" className="group flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-xs font-medium transition-colors" style={{ color: theme.node.text }} onMouseEnter={(event) => { event.currentTarget.style.background = theme.spatial.surface; }} onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }} onFocus={(event) => { event.currentTarget.style.background = theme.spatial.surface; }} onBlur={(event) => { event.currentTarget.style.background = "transparent"; }} onClick={() => onSelect(label)}>
                            <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.spatial.surface, color: theme.node.muted }}><Icon className="size-3.5" /></span>
                            <span className="min-w-0 truncate">{label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
