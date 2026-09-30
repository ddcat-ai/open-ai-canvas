// 创作页历史会话抽屉、导出与时间格式化。

import { conversationTimeFormatter, type CreationConversation, type CreationMessage, historyDayFormatter, modeLabels } from "./creation-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { App, Dropdown } from "antd";
import { displayCreationPrompt } from "./creation-references";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { Clapperboard, Download, Image as ImageIcon, MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { conversationTimestamp } from "./creation-conversations";
import { formatMessageTime } from "./creation-workspace-messages";

export function creationConversationBucket(updatedAt: string): "today" | "yesterday" | "week" | "earlier" {
    const at = new Date(updatedAt).getTime();
    if (!Number.isFinite(at)) return "earlier";
    const nowStart = new Date();
    nowStart.setHours(0, 0, 0, 0);
    const targetStart = new Date(at);
    targetStart.setHours(0, 0, 0, 0);
    const days = Math.round((nowStart.getTime() - targetStart.getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return "week";
    return "earlier";
}

export const creationBucketLabels: Record<"today" | "yesterday" | "week" | "earlier", string> = { today: "今天", yesterday: "昨天", week: "近 7 天", earlier: "更早" };

export function CreationHistoryDrawer({
    open,
    conversations,
    activeId,
    onNew,
    onClose,
    onSelect,
    onDelete,
    onRename,
}: {
    open: boolean;
    conversations: CreationConversation[];
    activeId: string;
    onNew: () => void;
    onClose: () => void;
    onSelect: (conversation: CreationConversation) => void;
    onDelete: (conversation: CreationConversation) => void;
    onRename: (conversation: CreationConversation, title: string) => void;
}) {
    const [keyword, setKeyword] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const skipRenameCommitRef = useRef(false);

    const assistantName = useAppearanceStore((state) => state.appearance.brandName);
    const exportUser = useUserStore((state) => state.user);

    const { message: drawerToast } = App.useApp();

    useEffect(() => {
        if (!open) return;
        setKeyword("");
        setRenamingId(null);
        setMenuOpenId(null);
    }, [open]);

    const commitRename = (conversation: CreationConversation) => {
        const shouldSkip = skipRenameCommitRef.current;
        skipRenameCommitRef.current = false;
        const value = renameInputRef.current?.value.trim() || "";
        setRenamingId(null);
        if (shouldSkip || !value) return;
        const original = conversation.title.trim() || "新创作";
        if (value === original) return;
        onRename(conversation, value);
    };

    const cancelRename = () => {
        skipRenameCommitRef.current = true;
        setRenamingId(null);
    };

    const beginRename = (conversation: CreationConversation) => {
        skipRenameCommitRef.current = false;
        setMenuOpenId(null);
        setRenamingId(conversation.id);
    };

    const visibleConversations = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        if (!query) return conversations;
        return conversations.filter((conversation) => {
            const latest = conversationPreviewMessage(conversation);
            const searchable = [
                conversation.title,
                ...conversation.messages.flatMap((message) => [message.content, displayCreationPrompt(message.content, message.references || [])]),
                latest?.mode ? modeLabels[latest.mode] : "创作",
                formatConversationTime(conversation.updatedAt),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return searchable.includes(query);
        });
    }, [conversations, keyword]);

    return (
        <AppDrawer
            flush
            open={open}
            onClose={onClose}
            placement="right"
            size="min(440px, 100vw)"
            closeIcon={<X className="size-4" />}
            className="creation-history-drawer"
            rootClassName="creation-history-drawer-root"
            title={
                <div className="creation-history-title">
                    <span>历史对话</span>
                    <small>{conversations.length} 个对话</small>
                </div>
            }
        >
            <div className="creation-history-content">
                <label className="creation-history-search">
                    <Search aria-hidden="true" />
                    <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索对话标题或内容" aria-label="搜索历史对话" />
                </label>

                <button type="button" className="creation-history-new" onClick={onNew}>
                    <span className="creation-history-new-icon">
                        <Plus />
                    </span>
                    <span className="creation-history-new-copy">
                        <strong>新建创作</strong>
                        <small>开启一个新的创作对话</small>
                    </span>
                </button>
                {visibleConversations.length ? (
                    <ul className="creation-history-list" aria-label="历史对话，按更新时间倒序排列">
                        {visibleConversations.flatMap((conversation, index) => {
                            const showGroupHead = !keyword.trim() && (index === 0 || creationConversationBucket(conversation.updatedAt) !== creationConversationBucket(visibleConversations[index - 1].updatedAt));
                            const latest = conversationPreviewMessage(conversation);
                            const active = conversation.id === activeId;
                            const HistoryTypeIcon = latest?.mode === "video" ? Clapperboard : latest?.mode === "image" ? ImageIcon : latest?.mode === "text" ? MessageSquareText : Sparkles;
                            return [
                                showGroupHead ? (
                                    <li key={`${conversation.id}-group`} className="creation-history-group-head">
                                        <h4>{creationBucketLabels[creationConversationBucket(conversation.updatedAt)]}</h4>
                                    </li>
                                ) : null,
                                <li key={conversation.id} className={active ? "is-active" : undefined}>
                                    {renamingId === conversation.id ? (
                                        <div className="creation-history-rename">
                                            <input
                                                ref={renameInputRef}
                                                className="creation-history-rename-input"
                                                defaultValue={conversation.title.trim() || "新创作"}
                                                aria-label="重命名对话标题"
                                                autoFocus
                                                onFocus={(event) => event.currentTarget.select()}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        event.currentTarget.blur();
                                                    } else if (event.key === "Escape") {
                                                        cancelRename();
                                                    }
                                                }}
                                                onBlur={() => commitRename(conversation)}
                                            />
                                        </div>
                                    ) : (
                                        <div className={menuOpenId === conversation.id ? "creation-history-row is-menu-open" : "creation-history-row"}>
                                            <button
                                                type="button"
                                                className="creation-history-item-main"
                                                aria-current={active ? "page" : undefined}
                                                onClick={() => {
                                                    setMenuOpenId(null);
                                                    onSelect(conversation);
                                                }}
                                            >
                                                <span className="creation-history-item-icon" aria-hidden="true">
                                                    <HistoryTypeIcon />
                                                </span>
                                                <span className="creation-history-item-text">
                                                    <strong className="creation-history-item-heading">{conversation.title.trim() || "新创作"}</strong>
                                                    <span className="creation-history-snippet">
                                                        {latest ? (
                                                            <>
                                                                <em>{latest.mode ? modeLabels[latest.mode] : "创作"}</em>
                                                                <span>{displayCreationPrompt(latest.content, latest.references || []).trim() || "还没有开始创作"}</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <em>创作</em>
                                                                <span>还没有开始创作</span>
                                                            </>
                                                        )}
                                                    </span>
                                                </span>
                                            </button>
                                            <span className="creation-history-time-slot" aria-hidden={menuOpenId === conversation.id}>
                                                <time dateTime={conversation.updatedAt}>{formatHistoryRelativeTime(conversation.updatedAt)}</time>
                                            </span>
                                            <Dropdown
                                                trigger={["click"]}
                                                placement="bottomRight"
                                                open={menuOpenId === conversation.id}
                                                onOpenChange={(open) => setMenuOpenId(open ? conversation.id : null)}
                                                overlayClassName="creation-history-menu-overlay"
                                                menu={{
                                                    items: [
                                                        { key: "rename", label: "重命名", icon: <Pencil /> },
                                                        { key: "export", label: "导出对话", icon: <Download /> },
                                                        { key: "delete", label: "删除对话", danger: true, icon: <Trash2 /> },
                                                    ],
                                                    onClick: ({ key }) => {
                                                        setMenuOpenId(null);
                                                        if (key === "rename") {
                                                            beginRename(conversation);
                                                        } else if (key === "export") {
                                                            downloadCreationConversation(conversation, assistantName, exportUser?.displayName || "你");
                                                            drawerToast.success("对话已导出为 Markdown");
                                                        } else {
                                                            onDelete(conversation);
                                                        }
                                                    },
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    className={menuOpenId === conversation.id ? "creation-history-more is-open" : "creation-history-more"}
                                                    aria-label={`更多操作：${conversation.title.trim() || "新创作"}`}
                                                    onClick={(event) => event.preventDefault()}
                                                >
                                                    <MoreHorizontal />
                                                </button>
                                            </Dropdown>
                                        </div>
                                    )}
                                </li>,
                            ];
                        })}
                    </ul>
                ) : (
                    <div className="creation-history-empty">{keyword.trim() ? "没有找到匹配的对话" : "暂无历史对话"}</div>
                )}
            </div>
        </AppDrawer>
    );
}

export function buildConversationExportMarkdown(conversation: CreationConversation, assistantName: string, userName: string) {
    const lines: string[] = [`# ${conversation.title.trim() || "新创作"}`, ""];
    for (const message of conversation.messages) {
        const stamp = formatMessageTime(message.createdAt);
        const modeTag = message.mode && message.mode !== "text" ? (message.mode === "image" ? "[图像生成] " : "[视频生成] ") : "";
        const speaker = message.role === "user" ? userName || "我" : assistantName;
        if (message.role === "user") {
            const prompt = displayCreationPrompt(message.content, message.references || []).trim();
            if (!prompt) continue;
            lines.push(`## ${speaker} · ${stamp}`, "", prompt, "");
        } else {
            const body = (message.content || "").trim();
            if (body) lines.push(`## ${speaker} · ${stamp}`, "", `${modeTag}${body}`, "");
            else if (message.resultUrls?.length) lines.push(`## ${speaker} · ${stamp}`, "", `${modeTag}已生成，素材保留在项目中。`, "");
            else continue;
            if (message.reasoning?.trim()) lines.push("> 思考过程：", message.reasoning.trim(), "");
        }
    }
    return lines.join("\n").trim() + "\n";
}

export function downloadCreationConversation(conversation: CreationConversation, assistantName: string, userName: string) {
    const safeTitle = (conversation.title.trim() || "新创作").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "新创作";
    const blob = new Blob([buildConversationExportMarkdown(conversation, assistantName, userName)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeTitle}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export function conversationPreviewMessage(conversation: CreationConversation) {
    let fallback: CreationMessage | undefined;
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        const message = conversation.messages[index];
        if (!message.content.trim()) continue;
        fallback ||= message;
        if (message.role === "user") return message;
    }
    return fallback;
}

export function formatHistoryRelativeTime(value: string) {
    const timestamp = conversationTimestamp(value);
    if (!timestamp) return "";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "刚刚";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} 天前`;
    return historyDayFormatter.format(timestamp);
}

export function formatConversationTime(value: string) {
    const timestamp = conversationTimestamp(value);
    if (!timestamp) return "时间未知";
    return conversationTimeFormatter.format(timestamp);
}
