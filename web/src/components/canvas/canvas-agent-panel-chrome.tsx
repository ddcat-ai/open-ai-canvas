import { Button, Dropdown, Input, Tooltip } from "antd";
import { useState } from "react";
import { Bot, Check, Clapperboard, History, LayoutTemplate, PanelRightClose, PanelsTopLeft, Pencil, Plus, RotateCcw, Trash2, Workflow } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasAssistantSession } from "@/types/canvas";
import { useUserStore } from "@/stores/use-user-store";

const MAX_AGENT_TITLE_LENGTH = 32;

export function AgentPanelChrome({
    theme,
    canUndo,
    undoCount,
    onUndo,
    onCollapse,
    historyCount = 0,
    sessions = [],
    activeSessionId,
    onOpenSession,
    onRenameSession,
    onDeleteSession,
    onNewChat,
    newChatDisabled = false,
    conversationTitle = "AI 助手对话",
    onRenameConversation,
    floating = false,
    onToggleFloating,
}: {
    theme: CanvasTheme;
    canUndo: boolean;
    undoCount: number;
    onUndo: () => void;
    onCollapse: () => void;
    historyCount?: number;
    sessions?: CanvasAssistantSession[];
    activeSessionId?: string | null;
    onOpenSession?: (id: string) => void;
    onRenameSession?: (id: string, title: string) => void;
    onDeleteSession?: (id: string) => void;
    onNewChat?: () => void;
    newChatDisabled?: boolean;
    conversationTitle?: string;
    onRenameConversation?: (title: string) => void;
    floating?: boolean;
    onToggleFloating?: () => void;
}) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(conversationTitle);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingSessionTitle, setEditingSessionTitle] = useState("");
    const commitTitle = () => {
        const next = draftTitle.trim().slice(0, MAX_AGENT_TITLE_LENGTH);
        if (next) onRenameConversation?.(next);
        setEditingTitle(false);
    };
    const beginSessionRename = (session: CanvasAssistantSession) => {
        setEditingSessionId(session.id);
        setEditingSessionTitle(session.title.slice(0, MAX_AGENT_TITLE_LENGTH));
    };
    const commitSessionRename = () => {
        if (!editingSessionId) return;
        const title = editingSessionTitle.trim().slice(0, MAX_AGENT_TITLE_LENGTH);
        if (title) onRenameSession?.(editingSessionId, title);
        setEditingSessionId(null);
    };
    const sortedSessions = [...sessions].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));

    return (
        <header className="canvas-agent-header shrink-0 px-3 py-2.5" data-agent-drag-handle>
            <div className="flex min-w-0 items-center gap-2">
                <div className="canvas-agent-conversation-title-slot">
                    {editingTitle ? (
                        <Input autoFocus size="small" maxLength={MAX_AGENT_TITLE_LENGTH} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value.slice(0, MAX_AGENT_TITLE_LENGTH))} onPressEnter={commitTitle} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === "Escape") setEditingTitle(false); }} className="!w-40 !px-1 !text-sm !font-semibold" aria-label="编辑对话名" />
                    ) : (
                        <button type="button" className="canvas-agent-conversation-title block min-w-0 max-w-full truncate text-left text-sm font-semibold leading-7 hover:underline" onClick={() => { setDraftTitle(conversationTitle.slice(0, MAX_AGENT_TITLE_LENGTH)); setEditingTitle(true); }} aria-label="编辑对话名">{conversationTitle}</button>
                    )}
                </div>
                <div className="canvas-agent-header-actions ml-auto flex shrink-0 items-center gap-0.5">
                    {onNewChat ? (
                        <span className="canvas-agent-collapse-tooltip-trigger" data-tooltip="新建对话">
                            <Button type="text" className="canvas-agent-header-icon-action !h-7 !w-7 !min-w-7" shape="circle" disabled={newChatDisabled} style={{ color: theme.node.muted }} icon={<Plus className="size-3.5" />} onClick={onNewChat} aria-label="新建对话" />
                        </span>
                    ) : null}
                    {onOpenSession ? (
                        <Dropdown
                            trigger={["click"]}
                            open={historyOpen}
                            onOpenChange={setHistoryOpen}
                            placement="bottomRight"
                            popupRender={() => (
                                <div className="canvas-agent-history-dropdown" role="menu" aria-label="历史会话" style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: `0 18px 44px ${theme.spatial.shadow}` }}>
                                    <div className="canvas-agent-history-dropdown-heading">
                                        <span>历史会话</span>
                                        <span className="canvas-agent-history-dropdown-count">{sortedSessions.length}</span>
                                    </div>
                                    <div className="canvas-agent-history-dropdown-list">
                                        {sortedSessions.length ? sortedSessions.map((session) => {
                                            const active = session.id === activeSessionId;
                                            const editing = session.id === editingSessionId;
                                            return (
                                                <div key={session.id} className={`canvas-agent-history-row${active ? " is-active" : ""}`} role="menuitem" onClick={() => { if (!editing) { onOpenSession?.(session.id); setHistoryOpen(false); } }}>
                                                    <div className="canvas-agent-history-row-main">
                                                        {editing ? (
                                                            <Input autoFocus size="small" maxLength={MAX_AGENT_TITLE_LENGTH} value={editingSessionTitle} onChange={(event) => setEditingSessionTitle(event.target.value.slice(0, MAX_AGENT_TITLE_LENGTH))} onPressEnter={commitSessionRename} onBlur={commitSessionRename} onKeyDown={(event) => { if (event.key === "Escape") setEditingSessionId(null); }} aria-label="编辑会话名" />
                                                        ) : (
                                                            <div className="canvas-agent-history-row-title">{session.title || "新对话"}</div>
                                                        )}
                                                        <div className="canvas-agent-history-row-meta">{session.messages.at(-1)?.text?.replace(/\s+/g, " ").slice(0, 34) || "暂无消息"}</div>
                                                    </div>
                                                    <div className="canvas-agent-history-row-actions">
                                                        {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
                                                        <button type="button" className="canvas-agent-history-row-action" onClick={(event) => { event.stopPropagation(); beginSessionRename(session); }} aria-label={`重命名${session.title}`} title="重命名"><Pencil className="size-3.5" /></button>
                                                        <button type="button" className="canvas-agent-history-row-action is-danger" onClick={(event) => { event.stopPropagation(); onDeleteSession?.(session.id); }} aria-label={`删除${session.title}`} title="删除"><Trash2 className="size-3.5" /></button>
                                                    </div>
                                                </div>
                                            );
                                        }) : <div className="canvas-agent-history-dropdown-empty">暂无历史会话</div>}
                                    </div>
                                </div>
                            )}
                        >
                            <span className="canvas-agent-collapse-tooltip-trigger" data-tooltip={historyCount ? `历史会话 · ${historyCount}` : "历史会话"}>
                                <Button type="text" className={`canvas-agent-header-icon-action !h-7 !w-7 !min-w-7 ${historyOpen ? "is-active" : ""}`} shape="circle" style={{ color: historyOpen ? theme.node.text : theme.node.muted }} icon={<History className="size-3.5" />} aria-label="打开历史会话" aria-haspopup="menu" aria-expanded={historyOpen} />
                            </span>
                        </Dropdown>
                    ) : null}
                    {canUndo ? (
                        <Tooltip title={`撤销最近一批 Agent 写回，可撤销 ${undoCount} 批`} classNames={{ root: "canvas-agent-tooltip" }}>
                            <Button type="text" shape="circle" className="!h-7 !w-7 !min-w-7" style={{ color: theme.node.muted }} icon={<RotateCcw className="size-3.5" />} onClick={onUndo} aria-label="撤销最近一批 Agent 写回" />
                        </Tooltip>
                    ) : null}
                    <span className="canvas-agent-collapse-tooltip-trigger" data-tooltip="收起 Agent">
                        <Button type="text" shape="circle" className="canvas-agent-header-icon-action !h-7 !w-7 !min-w-7" style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-3.5" />} onClick={onCollapse} aria-label="收起 Agent" />
                    </span>
                </div>
            </div>
        </header>
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
