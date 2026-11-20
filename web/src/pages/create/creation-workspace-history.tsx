// 创作页历史会话抽屉、导出与时间格式化。

import { conversationTimeFormatter, type CreationConversation, type CreationMessage, historyDayFormatter, modeLabels } from "./creation-types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { App, Button, Dropdown, Input } from "antd";
import { displayCreationPrompt } from "./creation-references";
import { AppDrawer } from "@/components/ui/product/app-drawer";
import { Clapperboard, Download, Image as ImageIcon, MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Trash2, X, Orbit } from "lucide-react";
import { conversationTimestamp } from "./creation-conversations";
import { formatMessageTime } from "./creation-workspace-messages";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";

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

export const creationBucketLabels: Record<"today" | "yesterday" | "week" | "earlier", string> = {
    get today() {
        return translate("create.history.today");
    },
    get yesterday() {
        return translate("create.history.yesterday");
    },
    get week() {
        return translate("create.history.week");
    },
    get earlier() {
        return translate("create.history.earlier");
    },
};

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
    const { t } = useTranslation();
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
        const original = conversation.title.trim() || t("create.conversation.untitled");
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
                latest?.mode ? modeLabels[latest.mode] : t("create.history.creation"),
                formatConversationTime(conversation.updatedAt),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return searchable.includes(query);
        });
    }, [conversations, keyword, t]);

    return (
        <AppDrawer
            flush
            open={open}
            onClose={onClose}
            placement="right"
            size="min(440px, 100vw)"
            closable={{ placement: "end", closeIcon: <X className="size-4" /> }}
            className="creation-history-drawer"
            rootClassName="creation-history-drawer-root"
            title={
                <div className="creation-history-title">
                    <span>{t("create.history.title")}</span>
                    <small>{t("create.history.count", { count: conversations.length })}</small>
                </div>
            }
        >
            <div className="creation-history-content">
                <div className="creation-history-toolbar">
                    <Input
                        className="creation-history-search"
                        prefix={<Search aria-hidden="true" />}
                        allowClear
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder={t("create.history.searchPlaceholder")}
                        aria-label={t("create.history.searchLabel")}
                    />
                    <Button icon={<Plus />} onClick={onNew}>
                        {t("create.history.new")}
                    </Button>
                </div>
                {visibleConversations.length ? (
                    <ul className="creation-history-list" aria-label={t("create.history.listLabel")}>
                        {visibleConversations.flatMap((conversation, index) => {
                            const showGroupHead = !keyword.trim() && (index === 0 || creationConversationBucket(conversation.updatedAt) !== creationConversationBucket(visibleConversations[index - 1].updatedAt));
                            const latest = conversationPreviewMessage(conversation);
                            const active = conversation.id === activeId;
                            const HistoryTypeIcon = latest?.mode === "video" ? Clapperboard : latest?.mode === "image" ? ImageIcon : latest?.mode === "text" ? MessageSquareText : Orbit;
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
                                                defaultValue={conversation.title.trim() || t("create.conversation.untitled")}
                                                aria-label={t("create.history.renameLabel")}
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
                                                    <strong className="creation-history-item-heading">{conversation.title.trim() || t("create.conversation.untitled")}</strong>
                                                    <span className="creation-history-snippet">
                                                        {latest ? (
                                                            <>
                                                                <em>{latest.mode ? modeLabels[latest.mode] : t("create.history.creation")}</em>
                                                                <span>{displayCreationPrompt(latest.content, latest.references || []).trim() || t("create.history.notStarted")}</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <em>{t("create.history.creation")}</em>
                                                                <span>{t("create.history.notStarted")}</span>
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
                                                        { key: "rename", label: t("create.history.rename"), icon: <Pencil /> },
                                                        { key: "export", label: t("create.history.export"), icon: <Download /> },
                                                        { key: "delete", label: t("create.history.delete"), danger: true, icon: <Trash2 /> },
                                                    ],
                                                    onClick: ({ key }) => {
                                                        setMenuOpenId(null);
                                                        if (key === "rename") {
                                                            beginRename(conversation);
                                                        } else if (key === "export") {
                                                            downloadCreationConversation(conversation, assistantName, exportUser?.displayName || t("create.message.you"));
                                                            drawerToast.success(t("create.history.exported"));
                                                        } else {
                                                            onDelete(conversation);
                                                        }
                                                    },
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    className={menuOpenId === conversation.id ? "creation-history-more is-open" : "creation-history-more"}
                                                    aria-label={t("create.history.moreActions", { title: conversation.title.trim() || t("create.conversation.untitled") })}
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
                    <div className="creation-history-empty">{keyword.trim() ? t("create.history.noMatch") : t("create.history.empty")}</div>
                )}
            </div>
        </AppDrawer>
    );
}

export function buildConversationExportMarkdown(conversation: CreationConversation, assistantName: string, userName: string) {
    const lines: string[] = [`# ${conversation.title.trim() || translate("create.conversation.untitled")}`, ""];
    for (const message of conversation.messages) {
        const stamp = formatMessageTime(message.createdAt);
        const modeTag = message.mode && message.mode !== "text" ? (message.mode === "image" ? `[${translate("create.message.imageGeneration")}] ` : `[${translate("create.message.videoGeneration")}] `) : "";
        const speaker = message.role === "user" ? userName || translate("create.history.exportMe") : assistantName;
        if (message.role === "user") {
            const prompt = displayCreationPrompt(message.content, message.references || []).trim();
            if (!prompt) continue;
            lines.push(`## ${speaker} · ${stamp}`, "", prompt, "");
        } else {
            const body = (message.content || "").trim();
            if (body) lines.push(`## ${speaker} · ${stamp}`, "", `${modeTag}${body}`, "");
            else if (message.resultUrls?.length) lines.push(`## ${speaker} · ${stamp}`, "", `${modeTag}${translate("create.history.exportGenerated")}`, "");
            else continue;
            if (message.reasoning?.trim()) lines.push(`> ${translate("create.history.exportReasoning")}`, message.reasoning.trim(), "");
        }
    }
    return lines.join("\n").trim() + "\n";
}

export function downloadCreationConversation(conversation: CreationConversation, assistantName: string, userName: string) {
    const untitled = translate("create.conversation.untitled");
    const safeTitle = (conversation.title.trim() || untitled).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || untitled;
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
    if (seconds < 60) return translate("time.justNow");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return translate("time.minutesAgo", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return translate("time.hoursAgo", { count: hours });
    const days = Math.round(hours / 24);
    if (days < 7) return translate("time.daysAgo", { count: days });
    return historyDayFormatter.format(timestamp);
}

export function formatConversationTime(value: string) {
    const timestamp = conversationTimestamp(value);
    if (!timestamp) return translate("time.unknown");
    return conversationTimeFormatter.format(timestamp);
}
