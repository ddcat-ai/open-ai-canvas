import { useMemo, useRef, useState } from "react";
import { Button, Input, Popconfirm, type InputRef } from "antd";
import { ArrowLeft, CircleAlert, Cloud, HardDrive, History, LoaderCircle, MessageSquarePlus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/ui/product/empty-state";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { cloudAgentConversationServerId, type CloudAgentConversation } from "@/services/cloud-agent-conversations";
import { parseCloudAgentFormAnswer } from "./canvas-cloud-agent-chat-ui";

const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const monthDay = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const yearMonthDay = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });

function historyPreview(conversation: CloudAgentConversation) {
    const draft = conversation.draft?.trim();
    if (draft) return `草稿 · ${markdownPlainText(draft)}`;
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
        const message = conversation.messages[index];
        if (message.reasoning || (message.role !== "assistant" && message.role !== "user")) continue;
        if (message.role === "user" && message.text.trimStart().startsWith("{") && parseCloudAgentFormAnswer(message.text)) return "已确认创作方向";
        const text = markdownPlainText(message.text);
        if (text) return text;
        if (message.attachments?.length) return message.attachments.map((attachment) => attachment.name).join("、");
    }
    return conversation.messages.length ? "查看工作记录" : "暂无消息";
}

function highlightMatch(text: string, keyword: string) {
    const index = keyword ? text.toLowerCase().indexOf(keyword) : -1;
    if (index < 0) return text;
    const end = index + keyword.length;
    return (
        <>
            {text.slice(0, index)}
            <mark>{text.slice(index, end)}</mark>
            {text.slice(end)}
        </>
    );
}

export function AgentHistory({
    conversations,
    activeConversationId,
    onBack,
    onNew,
    onOpen,
    onDelete,
    loading,
    error,
    openingId,
    deletingId,
    disabledReason,
    onRefresh,
    onCollapse,
}: {
    conversations: CloudAgentConversation[];
    activeConversationId: string;
    onBack: () => void;
    onNew: () => void;
    onOpen: (conversation: CloudAgentConversation) => void;
    onDelete: (id: string) => void | Promise<void>;
    loading?: boolean;
    error?: string;
    openingId?: string;
    deletingId?: string;
    disabledReason?: string;
    onRefresh?: () => void;
    onCollapse?: () => void;
}) {
    const [query, setQuery] = useState("");
    const inputRef = useRef<InputRef>(null);
    const keyword = query.trim().toLowerCase();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const rows = useMemo(
        () =>
            conversations
                .filter((item) => item.id !== activeConversationId || item.run || item.messages.length || item.draft?.trim() || cloudAgentConversationServerId(item))
                .map((item) => ({ item, preview: historyPreview(item).slice(0, 160), date: new Date(item.updatedAt) }))
                .sort((left, right) => (right.date.getTime() || 0) - (left.date.getTime() || 0)),
        [conversations, activeConversationId],
    );
    const visible = keyword ? rows.filter(({ item, preview }) => item.title.toLowerCase().includes(keyword) || preview.toLowerCase().includes(keyword)) : rows;
    const groups = Map.groupBy(visible, ({ date }) => {
        if (!Number.isFinite(date.getTime())) return "日期未知";
        if (date.toDateString() === today.toDateString()) return "今天";
        if (date.toDateString() === yesterday.toDateString()) return "昨天";
        return (date.getFullYear() === today.getFullYear() ? monthDay : yearMonthDay).format(date);
    });
    const disabled = Boolean(disabledReason || openingId);
    return (
        <div className="canvas-agent-history-root flex min-h-0 min-w-0 flex-1 flex-col">
            <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-2">
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={onBack} aria-label="返回对话" />
                <h2 className="canvas-agent-history-heading">历史对话</h2>
                <span className="canvas-agent-history-count" role="status" aria-label={`${visible.length} 个对话`}>
                    {keyword ? `${visible.length} / ${rows.length}` : rows.length}
                </span>
                <div className="ml-auto flex items-center">
                    {onRefresh ? <Button type="text" shape="circle" loading={loading} icon={<RefreshCw className="size-4" />} onClick={onRefresh} aria-label="刷新云端对话" title="刷新云端对话" /> : null}
                    <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} disabled={disabled} onClick={onNew} aria-label="新建对话" title={disabledReason || "新建对话"} />
                    {onCollapse ? <Button type="text" shape="circle" icon={<X className="size-4" />} onClick={onCollapse} aria-label="收起 Agent" title="收起" /> : null}
                </div>
            </header>
            <div className="canvas-agent-history-toolbar">
                <Input
                    ref={inputRef}
                    className="canvas-agent-history-search"
                    prefix={<Search className="size-4" aria-hidden="true" />}
                    allowClear
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="搜索标题或摘要"
                    placeholder="搜索标题或摘要"
                />
            </div>
            <div className="canvas-agent-history-scroll thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto">
                {error ? (
                    <p role="status" className="canvas-agent-history-notice">
                        <CircleAlert className="size-4 shrink-0" />
                        {error}
                    </p>
                ) : null}
                {disabledReason ? (
                    <p role="status" className="canvas-agent-history-notice">
                        {disabledReason}
                    </p>
                ) : null}
                {Array.from(groups, ([label, entries]) => (
                    <section key={label} className="canvas-agent-history-group" aria-label={label}>
                        <h3>{label}</h3>
                        <ul>
                            {entries.map(({ item, preview, date }) => {
                                const current = item.id === activeConversationId;
                                const cloud = Boolean(cloudAgentConversationServerId(item));
                                return (
                                    <li key={item.id} className="canvas-agent-history-item" data-current={current || undefined}>
                                        <button type="button" className="canvas-agent-history-open" disabled={disabled} onClick={() => onOpen(item)} aria-current={current ? "page" : undefined} title={disabledReason || item.title}>
                                            <span className="canvas-agent-history-headline">
                                                <span className="canvas-agent-history-title">{highlightMatch(item.title, keyword)}</span>
                                                {current ? <span className="canvas-agent-history-current">当前</span> : null}
                                                {Number.isFinite(date.getTime()) ? <time dateTime={item.updatedAt}>{clock.format(date)}</time> : null}
                                            </span>
                                            <span className="canvas-agent-history-subline">
                                                <span className="canvas-agent-history-source" title={cloud ? "云端对话" : "本机对话"}>
                                                    {openingId === item.id ? <LoaderCircle className="motion-safe:animate-spin" /> : cloud ? <Cloud /> : <HardDrive />}
                                                    <span className="sr-only">{cloud ? "云端" : "本机"}</span>
                                                </span>
                                                <span className="canvas-agent-history-preview" title={preview}>
                                                    {highlightMatch(preview, keyword)}
                                                </span>
                                            </span>
                                        </button>
                                        <Popconfirm
                                            title={cloud ? "删除这段云端对话？" : "删除这段本机对话？"}
                                            description={cloud ? "Agent 历史会从账号中删除，任务、画布和素材不会删除。" : "对话和排队消息都会从本机移除。"}
                                            okText="删除"
                                            cancelText="取消"
                                            okButtonProps={{ danger: true }}
                                            onConfirm={() => onDelete(item.id)}
                                            getPopupContainer={(trigger) => trigger.closest<HTMLElement>(".canvas-agent-panel") || trigger.parentElement!}
                                        >
                                            <Button
                                                type="text"
                                                size="small"
                                                shape="circle"
                                                disabled={disabled || Boolean(deletingId && deletingId !== item.id)}
                                                className="canvas-agent-history-delete"
                                                icon={deletingId === item.id ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Trash2 className="size-3.5" />}
                                                aria-label={`删除对话 ${item.title}`}
                                                title={disabledReason || (cloud ? "删除云端对话" : "删除本机对话")}
                                            />
                                        </Popconfirm>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
                {!visible.length && (keyword || (!loading && !error)) ? (
                    <EmptyState
                        icon={keyword ? Search : History}
                        title={keyword ? "没有匹配的对话" : "还没有历史对话"}
                        description={keyword ? "可以换个标题或摘要里的词。" : "发送第一条消息后，可以在这里继续对话。"}
                        action={
                            keyword ? (
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setQuery("");
                                        inputRef.current?.focus();
                                    }}
                                >
                                    清除搜索
                                </Button>
                            ) : (
                                <Button size="small" onClick={onBack}>
                                    返回对话
                                </Button>
                            )
                        }
                    />
                ) : null}
                {!rows.length && loading && !keyword ? (
                    <p className="canvas-agent-history-notice" role="status">
                        <LoaderCircle className="size-4 motion-safe:animate-spin" />
                        正在读取对话…
                    </p>
                ) : null}
            </div>
        </div>
    );
}
