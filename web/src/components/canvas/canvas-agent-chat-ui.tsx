import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, CheckCircle2, CircleAlert, ImagePlus, LoaderCircle, RotateCcw, Sparkles, UserRound, Wrench, X, XCircle } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasAgentOperationImpact } from "@/lib/canvas/canvas-agent-ops";
import type { LocalUser } from "@/stores/use-user-store";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";

export type CanvasAgentChatAttachment = { id: string; name: string; url: string };
export type CanvasAgentMode = "online" | "local";
export type CanvasAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: CanvasAgentChatAttachment[];
};

export type CanvasAgentQuickAction = { label: string; prompt: string };

/**
 * Turn the short numbered choices the Agent already emits into real UI actions.
 * This deliberately stays conservative: only assistant messages with 1–4
 * numbered lines are eligible, and code blocks are ignored.
 */
export function extractCanvasAgentQuickActions(text: string): CanvasAgentQuickAction[] {
    if (!text.trim() || text.includes("```")) return [];
    const actions: CanvasAgentQuickAction[] = [];
    const seen = new Set<string>();
    for (const line of text.split(/\r?\n/u)) {
        const match = /^\s*(?:[-*]\s*)?(\d{1,2})[.)、]\s*(.+?)\s*$/u.exec(line);
        if (!match) continue;
        const label = match[2].replace(/^[*_\s]+|[*_\s]+$/gu, "").trim();
        if (!label || label.length > 96 || seen.has(label)) continue;
        seen.add(label);
        actions.push({ label, prompt: label });
        if (actions.length >= 4) break;
    }
    return actions;
}

const WORKING_TEXT = "正在推演...";

export function AgentChatMessage({ item, theme, user, isStreaming = false, retrying = false, onRejectTool, onApproveTool, onQuickAction, onRetry }: { item: CanvasAgentChatMessage; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; user: LocalUser | null; isStreaming?: boolean; retrying?: boolean; onRejectTool?: (id: string) => void; onApproveTool?: (id: string) => void; onQuickAction?: (prompt: string) => void; onRetry?: () => void }) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    const quickActions = item.role === "assistant" && !isStreaming ? extractCanvasAgentQuickActions(item.text) : [];
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return (
            <div className="flex items-start gap-2.5">
                <AgentAvatar theme={theme} />
                <AgentToolCard title={item.title || "工具调用"} text={item.text} detail={item.detail} theme={theme} />
            </div>
        );
    }
    return (
        <div className={`flex items-start gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser ? <AgentAvatar theme={theme} /> : null}
            <div className={`min-w-0 max-w-[86%] text-sm leading-6 ${isUser ? "rounded-md px-3 py-2.5 text-right" : "text-left"}`} style={{ color, ...(isUser ? { background: theme.accent.primarySoft } : {}) }}>
                {item.role === "assistant" ? <AIMessageMarkdown className="text-left" isStreaming={isStreaming}>{item.text}</AIMessageMarkdown> : <div className="whitespace-pre-wrap break-words text-left">{item.text}</div>}
                {item.role === "error" && onRetry ? (
                    <Button size="small" className="mt-2 !h-7" icon={retrying ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} disabled={retrying} onClick={onRetry}>
                        {retrying ? "重试中" : "重试本轮"}
                    </Button>
                ) : null}
                {quickActions.length && onQuickAction ? (
                    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="快捷选项">
                        {quickActions.map((action) => (
                            <motion.button
                                key={action.label}
                                type="button"
                                className="rounded-full px-3 py-1.5 text-left text-xs font-medium outline-none transition-[background-color,transform,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-current/30 hover:-translate-y-px"
                                style={{ background: theme.spatial.surface, color: theme.node.text, boxShadow: `0 4px 14px ${theme.spatial.shadow}` }}
                                whileTap={{ scale: 0.97 }}
                                onClick={() => onQuickAction(action.prompt)}
                            >
                                {action.label}
                            </motion.button>
                        ))}
                    </div>
                ) : null}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} /> : null}
                {item.meta ? <div className="mt-1 text-[var(--fs-label)] opacity-45">{item.meta}</div> : null}
            </div>
            {isUser ? <AgentUserAvatar user={user} theme={theme} /> : null}
        </div>
    );
}

export function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onReject?: () => void; onApprove?: () => void }) {
    const impact = agentImpactFromDetail(detail);
    return (
        <div className="flex items-start gap-2.5">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 flex-1 rounded-md p-3.5" style={{ background: "rgba(217,119,6,.07)", color: theme.node.text }}>
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ color: "#d97706", background: "rgba(217,119,6,.1)" }}>
                        <CircleAlert className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                            <span>确认工具调用</span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[var(--fs-label)] font-medium" style={{ color: "#d97706", background: "rgba(217,119,6,.1)" }}>等待确认</span>
                        </div>
                        <div className="mt-2 text-sm leading-6" style={{ color: theme.node.text }}>{summary}</div>
                    </div>
                </div>
                {impact?.operationCount ? (
                    <div className="mt-3 pt-1">
                        <div className="grid grid-cols-2 gap-2">
                            <ImpactMetric label="操作" value={impact.operationCount} theme={theme} />
                            <ImpactMetric label="涉及节点" value={impact.affectedNodeCount} theme={theme} />
                            <ImpactMetric label="删除" value={impact.destructiveCount} attention={impact.destructiveCount > 0} theme={theme} />
                            <ImpactMetric label="生成" value={impact.generationCount} attention={impact.generationCount > 0} theme={theme} />
                        </div>
                        {impact.items.length ? <div className="mt-3 space-y-1.5">{impact.items.map((item, index) => <div key={`${item}-${index}`} className="flex gap-2 text-xs leading-5" style={{ color: theme.node.muted }}><span className="mt-2 size-1 shrink-0 rounded-full bg-current" /><span>{item}</span></div>)}</div> : null}
                        {impact.warning ? <div className="mt-3 rounded-md bg-amber-500/[.08] px-2.5 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{impact.warning}</div> : null}
                    </div>
                ) : null}
                {detail ? <details className="mt-3 pt-1"><summary className="cursor-pointer text-xs" style={{ color: theme.node.muted }}>技术详情</summary><AgentDetailBlock detail={detail} theme={theme} /></details> : null}
                {onReject || onApprove ? (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button danger className="!h-9" icon={<XCircle className="size-4" />} onClick={() => onReject?.()}>
                            拒绝执行
                        </Button>
                        <Button className="!h-9" icon={<CheckCircle2 className="size-4" />} style={{ borderColor: "rgba(22,163,74,.42)", color: "#16a34a", background: "transparent" }} onClick={() => onApprove?.()}>
                            批准执行
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ImpactMetric({ label, value, attention = false, theme }: { label: string; value: number; attention?: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return <div className="px-1 py-1"><div className="text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{label}</div><div className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: attention ? "#d97706" : theme.node.text }}>{value}</div></div>;
}

function agentImpactFromDetail(detail: unknown) {
    const impact = objectField(detail, "impact");
    if (!impact || typeof impact !== "object") return null;
    const value = impact as Partial<CanvasAgentOperationImpact>;
    return {
        operationCount: Number(value.operationCount) || 0,
        affectedNodeCount: Number(value.affectedNodeCount) || 0,
        destructiveCount: Number(value.destructiveCount) || 0,
        generationCount: Number(value.generationCount) || 0,
        items: Array.isArray(value.items) ? value.items.filter((item): item is string => typeof item === "string") : [],
        warning: typeof value.warning === "string" ? value.warning : "",
    } satisfies CanvasAgentOperationImpact;
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const state = toolCardState(title, text, detail);
    return (
        <details className="min-w-0 flex-1 rounded-md px-3 py-3 text-left" style={{ background: theme.spatial.surface, color: theme.node.text }}>
            <summary className="cursor-pointer list-none">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ color: state.color, background: state.softBg }}>
                        {state.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                            <span className="min-w-0 truncate">{title}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[var(--fs-label)] font-medium" style={{ color: state.color, background: state.softBg }}>
                                {state.label}
                            </span>
                            {detail ? <span className="ml-auto text-xs font-normal" style={{ color: theme.node.muted }}>详情</span> : null}
                        </div>
                        <div className="mt-2 text-sm leading-6" style={{ color: state.isError ? state.color : theme.node.muted }}>
                            {text}
                        </div>
                    </div>
                </div>
            </summary>
            {detail ? <AgentDetailBlock detail={detail} theme={theme} /> : null}
        </details>
    );
}

export function AgentWorkingMessage({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const [length, setLength] = useState(1);
    useEffect(() => {
        const timer = window.setInterval(() => setLength((value) => (value >= WORKING_TEXT.length + 4 ? 1 : value + 1)), 120);
        return () => window.clearInterval(timer);
    }, [setLength]);
    return (
        <div className="flex items-start gap-2.5">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 max-w-[82%]">
                <div className="font-mono text-sm" style={{ color: theme.node.muted }} aria-label={WORKING_TEXT}>
                    <span className="inline-block w-[96px]">{WORKING_TEXT.slice(0, Math.min(length, WORKING_TEXT.length))}</span>
                </div>
            </div>
        </div>
    );
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onAddFiles,
    onRemoveAttachment,
    left,
    references = [],
    slashSkills,
    includeAssetLibrary,
}: {
    prompt: string;
    attachments?: CanvasAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    left?: ReactNode;
    /** 供「@」插入的画布节点/素材/技能引用候选（可选，默认空，缺省时退化为普通输入框） */
    references?: CanvasResourceReference[];
    /** 供「/」弹出的技能候选（可选） */
    slashSkills?: Skill[];
    /** 是否在「@」候选里包含素材库资源 */
    includeAssetLibrary?: boolean;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const availableSlashSkills = slashSkills ?? [];
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const reducedMotion = useReducedMotion();
    const activeSlashIndex = Math.min(Math.max(slashIndex, 0), Math.max(availableSlashSkills.length - 1, 0));

    // 在输入值末尾检测「/关键词」打开技能候选；选择后替换为 @[skill:xxx] 引用 token（保持在 prompt 文本里）。
    const handlePromptChange = (value: string) => {
        onPromptChange(value);
        const match = /(^|\s)\/([^\s/]*)$/.exec(value);
        if (match && availableSlashSkills.length) {
            const next = { start: match.index + match[1].length, query: match[2] };
            setSlash((current) => (current && current.start === next.start && current.query === next.query ? current : next));
            setSlashIndex(0);
        } else if (slash) {
            setSlash(null);
        }
    };

    const applySlashSkill = (skill: Skill) => {
        const token = `@[skill:${skill.skill_id}] `;
        const next = slash
            ? `${prompt.slice(0, slash.start)}${token}${prompt.slice(slash.start + slash.query.length)}`
            : prompt
                ? `${prompt.replace(/\s+$/u, "")} ${token}`
                : token;
        setSlash(null);
        setSlashIndex(0);
        onPromptChange(next);
    };

    // slash 菜单的键盘控制在 capture 阶段拦截（contentEditable/textarea 内部先消费 Enter，外层冒泡拿不到）
    const handleSlashKeyCapture = (event: ReactKeyboardEvent) => {
        if (!slash || !availableSlashSkills.length) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.min(index + 1, availableSlashSkills.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            applySlashSkill(availableSlashSkills[activeSlashIndex]);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSlash(null);
        }
    };

    // 保留粘贴图片成附件（contentEditable 模式内部会把粘贴转纯文本，capture 阶段先拦截图片）
    const handlePasteCapture = (event: ReactClipboardEvent) => {
        if (!onAddFiles) return;
        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        event.preventDefault();
        event.stopPropagation();
        void onAddFiles(images);
    };

    return (
        <div className="px-3 pb-3 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div
                className="group/composer rounded-[22px] px-3 pb-2.5 pt-3 transition-[background-color,box-shadow,transform] duration-200 focus-within:-translate-y-px"
                style={{
                    background: theme.node.fill,
                    color: theme.accent.primary,
                    boxShadow: `0 16px 40px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,0.045)`,
                }}
            >
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-md" title={item.name}>
                                <img src={item.url} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <button type="button" className="absolute right-1 top-1 grid size-5 place-items-center rounded-full opacity-0 shadow-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel, color: theme.node.text }} onClick={() => onRemoveAttachment(item.id)} aria-label="移除图片">
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="relative" onKeyDownCapture={handleSlashKeyCapture} onPasteCapture={handlePasteCapture}>
                    <div className="thin-scrollbar max-h-40 min-h-[60px] overflow-y-auto">
                        <CanvasResourceMentionTextarea
                            value={prompt}
                            references={references}
                            includeAssetLibrary={includeAssetLibrary}
                            sendOnEnter={false}
                            disabled={disabled}
                            onChange={handlePromptChange}
                            onSubmit={onSubmit}
                            className="w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                            containerClassName="min-h-[60px]"
                            style={{ color: theme.node.text }}
                            placeholder={placeholder}
                            aria-label="Agent 输入"
                        />
                    </div>
                    {slash && availableSlashSkills.length ? (
                        <div
                            data-agent-slash-menu
                            className="absolute bottom-full left-0 z-[var(--z-toolbar)] mb-2 w-full max-w-xs overflow-hidden rounded-2xl p-1.5 shadow-2xl"
                            style={{ background: theme.toolbar.panel, boxShadow: `0 18px 44px ${theme.spatial.shadow}` }}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {availableSlashSkills.map((skill, index) => (
                                <button
                                    key={skill.skill_id}
                                    type="button"
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                                    style={{ background: index === activeSlashIndex ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                    onMouseEnter={() => setSlashIndex(index)}
                                    onClick={() => applySlashSkill(skill)}
                                >
                                    <Sparkles className="size-3.5 shrink-0 opacity-70" />
                                    <span className="min-w-0 truncate font-medium">{skill.skill_name}</span>
                                    {skill.description ? <span className="min-w-0 flex-1 truncate opacity-50">{skill.description}</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Tooltip title="上传图片">
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8 !transition-transform hover:!scale-105 active:!scale-95" disabled={sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <motion.button
                        type="button"
                        disabled={!canSubmit}
                        aria-label={sending ? "发送中" : "发送"}
                        onClick={() => void onSubmit()}
                        whileHover={canSubmit && !reducedMotion ? { scale: 1.06, y: -1 } : undefined}
                        whileTap={canSubmit && !reducedMotion ? { scale: 0.9, y: 1 } : undefined}
                        animate={sending && !reducedMotion ? { scale: [1, 0.94, 1], rotate: [0, -5, 5, 0] } : { scale: 1, rotate: 0 }}
                        transition={sending && !reducedMotion ? { duration: 0.42, ease: "easeOut" } : { type: "spring", stiffness: 420, damping: 24 }}
                        className="grid size-9 shrink-0 place-items-center rounded-full p-0 outline-none transition-[background-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                        style={{
                            background: canSubmit || sending ? theme.accent.primary : theme.spatial.surface,
                            color: canSubmit || sending ? theme.accent.onPrimary : theme.node.muted,
                            boxShadow: canSubmit || sending ? `0 8px 20px ${theme.accent.primary}45` : "none",
                        }}
                    >
                        <motion.span
                            key={sending ? "sending" : "ready"}
                            initial={reducedMotion ? false : { opacity: 0, scale: 0.65, rotate: sending ? -25 : 25 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
                            className="grid place-items-center"
                        >
                            {sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                        </motion.span>
                    </motion.button>
                </div>
            </div>
        </div>
    );
}

export function AgentPanelTabs<T extends string>({ value, items, theme, right, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; right?: ReactNode; onChange: (value: T) => void }) {
    return (
        <div className="shrink-0 px-3 pb-1">
            <div className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-0.5 py-0.5" style={{ background: "transparent" }}>
                <nav className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr items-center gap-0.5 text-[var(--fs-label)]" role="tablist" aria-label="Agent 面板">
                    {items.map((item) => (
                        <button key={item.value} type="button" role="tab" aria-selected={value === item.value} className={`inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 transition-colors ${value === item.value ? "font-medium" : "font-normal"}`} style={{ background: value === item.value ? theme.node.fill : "transparent", color: value === item.value ? theme.node.text : theme.node.muted, boxShadow: value === item.value ? `0 2px 8px ${theme.spatial.shadow}` : "none" }} onClick={() => onChange(item.value)}>
                            <span className="shrink-0">{item.icon}</span>
                            <span className="min-w-0 truncate">{item.label}</span>
                            {item.count ? <span className="shrink-0 tabular-nums opacity-60">{item.count}</span> : null}
                        </button>
                    ))}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
        </div>
    );
}

function AgentDetailBlock({ detail, theme }: { detail: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <pre className="thin-scrollbar mt-3 max-h-64 overflow-auto rounded-md p-3 text-[var(--fs-label)] leading-4" style={{ background: theme.toolbar.panel, color: theme.node.muted }}>
            {JSON.stringify(detail, null, 2)}
        </pre>
    );
}

function AgentAvatar({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <span className="grid size-7 shrink-0 place-items-center" role="img" aria-label="OpenAI">
            <span className="size-4 opacity-80" style={{ background: theme.node.text, WebkitMask: "url(/icons/openai.svg) center / contain no-repeat", mask: "url(/icons/openai.svg) center / contain no-repeat" }} />
        </span>
    );
}

function AgentUserAvatar({ user, theme }: { user: LocalUser | null; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const avatarUrl = user?.avatarUrl?.trim();
    return (
        <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full" style={{ color: theme.node.text }}>
            {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : <UserRound className="size-4" />}
        </span>
    );
}

function AgentMessageAttachments({ attachments }: { attachments: CanvasAgentChatAttachment[] }) {
    return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
            {attachments.map((item) => (
                <img key={item.id} src={item.url} alt={item.name} className="aspect-square w-full rounded-lg object-cover" />
            ))}
        </div>
    );
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const tool = String(objectField(detail, "name") || objectField(detail, "tool") || "");
    if (objectField(detail, "status") === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw)) return { label: "未生效", color: "#d97706", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (/拒绝|取消/.test(raw) || lower.includes("rejected")) return { label: "拒绝执行", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (/失败|错误/.test(raw) || lower.includes("failed") || lower.includes("error")) return { label: "执行失败", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (/完成|成功/.test(raw) || lower.includes("completed") || lower.includes("succeeded")) return { label: tool === "canvas_apply_ops" || /画布操作/.test(title) ? "已批准执行" : "执行完成", color: "#16a34a", softBg: "rgba(22,163,74,.04)", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: "工具调用", color: "#2563eb", softBg: "rgba(37,99,235,.04)", icon: <Wrench className="size-4" />, isError: false };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
