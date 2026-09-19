import { agentCanvasActions, agentCanvasActionLabel } from "@/lib/canvas/agent-canvas-actions";
import { Button } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, AtSign, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, CircleDot, Eye, HelpCircle, ImagePlus, ListChecks, LoaderCircle, Pencil, Plus, RotateCcw, Sparkles, Square, X, XCircle } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingGlow } from "@/components/ai/working-indicator";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";
import { buildSkillMentionReferences } from "@/services/skill-runtime";
import { agentToolCategory, agentToolCategoryLabel, agentToolStatus, friendlyAgentToolSummary } from "@/lib/canvas/agent-tool-presentation";

export type CloudAgentChatAttachment = { id: string; name: string; url: string };
type CloudAgentOperationImpact = {
    operationCount: number;
    affectedNodeCount: number;
    destructiveCount: number;
    generationCount: number;
    items: string[];
    warning?: string;
};
export type CloudAgentPlanItem = { id: string; title: string; status: "pending" | "doing" | "done" };
export type CloudAgentUserQuestion = {
    question: string;
    options: Array<{ label: string; detail?: string }>;
    allowFreeform?: boolean;
};
export type CloudAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    streaming?: boolean;
    reasoning?: boolean;
    planItems?: CloudAgentPlanItem[];
    question?: CloudAgentUserQuestion;
    meta?: string;
    detail?: unknown;
    attachments?: CloudAgentChatAttachment[];
    interjection?: "sent" | "undelivered";
};

export type CloudAgentQuickAction = { label: string; prompt: string };

/**
 * Turn the short numbered choices the Agent already emits into real UI actions.
 * This deliberately stays conservative: only assistant messages with 1–4
 * numbered lines are eligible, and code blocks are ignored.
 */
export function extractCloudAgentQuickActions(text: string): CloudAgentQuickAction[] {
    if (!text.trim() || text.includes("```")) return [];
    const actions: CloudAgentQuickAction[] = [];
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

const WORKING_TEXT = "正在处理";
const MIN_AGENT_PROMPT_HEIGHT = 60;
const MAX_AGENT_PROMPT_HEIGHT = 240;

function clampAgentPromptHeight(height: number) {
    return Math.min(MAX_AGENT_PROMPT_HEIGHT, Math.max(MIN_AGENT_PROMPT_HEIGHT, Math.ceil(height)));
}


export function AgentChatMessage({
    item,
    theme,
    references = [],
    isStreaming = false,
    retrying = false,
    onRejectTool,
    onApproveTool,
    onRetry,
    onFocusNode,
}: {
    item: CloudAgentChatMessage;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    references?: CanvasResourceReference[];
    isStreaming?: boolean;
    retrying?: boolean;
    onRejectTool?: (id: string) => void;
    onApproveTool?: (id: string) => void;
    onRetry?: () => void;
    onFocusNode?: (nodeId: string) => void;
}) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#ef4444" : theme.node.text;
    if (item.reasoning) {
        return (
            <div className="agent-reasoning" style={{ "--agent-reasoning-accent": theme.accent.primary } as CSSProperties}>
                <details className={`agent-reasoning-card${item.streaming ? " is-streaming" : ""}`} open={item.streaming || undefined}>
                    <summary className="agent-reasoning-summary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/20">
                        <span className="agent-reasoning-icon" aria-hidden="true"><Sparkles className="size-3.5" /></span>
                        <span className="agent-reasoning-copy">
                            <span className="agent-reasoning-title">{item.streaming ? "模型正在思考" : "模型思考"}</span>
                            <span className="agent-reasoning-subtitle">{item.streaming ? "整理目标与下一步" : "推理摘要"}</span>
                        </span>
                        <span className={`agent-reasoning-status${item.streaming ? " is-live" : ""}`}>
                            {item.streaming ? <span className="agent-reasoning-status-dot" aria-hidden="true" /> : null}
                            {item.streaming ? "实时" : "查看"}
                        </span>
                        <ChevronDown className="agent-reasoning-chevron" aria-hidden="true" />
                    </summary>
                    <div className="agent-reasoning-content" data-canvas-wheel-scroll>
                        <div className="agent-reasoning-text">{item.text || (item.streaming ? "正在整理思路…" : "暂无可展示的推理摘要")}</div>
                    </div>
                </details>
            </div>
        );
    }
    if (isSystem) {
        return (
            <div className="flex items-start gap-3 text-xs">
                <AgentTimelineMarker theme={theme} tone="muted" icon={<Sparkles className="size-3" />} />
                <div className="min-w-0 flex-1 py-0.5 leading-5" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return (
            <div className="flex min-w-0 items-start">
                <AgentToolCard title={item.title || "工具调用"} text={item.text} detail={item.detail} theme={theme} references={references} onFocusNode={onFocusNode} />
            </div>
        );
    }
    if (item.role === "error") {
        return (
            <div className="flex items-start gap-3">
                <AgentTimelineMarker theme={theme} tone="error" icon={<CircleAlert className="size-3.5" />} />
                <div className="min-w-0 flex-1 py-0.5 text-[13px] leading-5">
                    <div className="font-medium" style={{ color }}>{item.title || "Agent 暂时无法继续"}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words" style={{ color: theme.node.muted }}>{item.text}</div>
                    {item.meta ? <div className="mt-1 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>{item.meta}</div> : null}
                    {onRetry ? (
                        <Button type="text" size="small" className="mt-1 !h-7 !px-0" icon={retrying ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} disabled={retrying} onClick={onRetry}>
                            {retrying ? "重试中" : "重试本轮"}
                        </Button>
                    ) : null}
                </div>
            </div>
        );
    }
    return (
        <div className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser ? <AgentTimelineMarker theme={theme} tone="agent" /> : null}
            <div className={`min-w-0 text-sm leading-6 ${isUser ? "max-w-[82%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-right" : "max-w-[calc(100%-36px)] flex-1 text-left"}`} style={{ color, ...(isUser ? { background: theme.node.agentUserMessage } : {}) }}>
                {item.interjection ? (
                    <span
                        className="mb-1 inline-flex items-center rounded-full px-1.5 py-[1px] text-[var(--fs-label)] leading-4"
                        style={item.interjection === "undelivered"
                            ? { background: `${theme.accent.danger}22`, color: theme.accent.danger }
                            : { background: "rgba(255,255,255,0.16)", opacity: 0.72 }}
                    >
                        {item.interjection === "undelivered" ? "插话未送达" : "插话"}
                    </span>
                ) : null}
                {item.role === "assistant" ? (
                    <AIMessageMarkdown className="text-left" isStreaming={isStreaming}>
                        {item.text}
                    </AIMessageMarkdown>
                ) : (
                    <AgentMessageText text={item.text} references={references} />
                )}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} /> : null}
                {item.meta ? <div className="mt-1 text-[var(--fs-label)] opacity-45">{item.meta}</div> : null}
            </div>
        </div>
    );
}

function AgentMessageText({ text, references }: { text: string; references: CanvasResourceReference[] }) {
    const parts = splitAgentMessageMentions(text, references);
    return (
        <div className="whitespace-pre-wrap break-words text-left">
            {parts.map((part, index) => part.reference ? (
                <span key={`${part.token}-${index}`} className="agent-message-mention" title={part.reference.title || part.reference.label}>
                    <span aria-hidden="true" className="agent-message-mention-icon">{part.reference.kind === "skill" ? "✦" : "@"}</span>
                    <span>{part.reference.label}</span>
                </span>
            ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
        </div>
    );
}

type AgentMessageMentionPart = { text: string; token?: string; reference?: CanvasResourceReference };

function splitAgentMessageMentions(text: string, references: CanvasResourceReference[]): AgentMessageMentionPart[] {
    if (!text) return [];
    const byToken = new Map<string, CanvasResourceReference>();
    references.forEach((reference) => {
        byToken.set(canvasResourceMentionTokenForAgentMessage(reference), reference);
        if (reference.kind === "skill" && reference.skill?.skillName) byToken.set(`@${reference.skill.skillName}`, reference);
    });
    return text.split(/(@\[[^\]]+\])/gu).map((part) => {
        const reference = byToken.get(part);
        if (reference) return { text: "", token: part, reference };
        // Never expose an internal Skill ID in the chat bubble when an old
        // conversation references a removed/unloaded Skill.
        if (/^@\[skill:[^\]]+\]$/u.test(part)) return { text: "技能包" };
        return { text: part };
    });
}

function canvasResourceMentionTokenForAgentMessage(reference: CanvasResourceReference) {
    if (reference.mentionToken) return reference.mentionToken;
    if (reference.kind === "skill" && reference.skill?.skillId) return `@[skill:${reference.skill.skillId}]`;
    if (reference.assetId) return `@[asset:${reference.assetId}]`;
    return `@[node:${reference.nodeId}]`;
}

export function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onReject?: () => void; onApprove?: () => void }) {
    const impact = agentImpactFromDetail(detail);
    const friendlySummary = friendlyAgentToolSummary(agentToolName("", detail), summary, detail, true);
    return (
        <div className="flex items-start gap-3">
            <AgentTimelineMarker theme={theme} tone="approval" icon={<CircleAlert className="size-3.5" />} />
            <div className="agent-pending-tool min-w-0 flex-1 rounded-lg border py-2 pl-3 pr-3" style={{ borderColor: "rgba(249,115,22,.22)", background: "rgba(249,115,22,.05)", color: theme.node.text }}>
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold leading-5">
                            <span>需要你的确认</span>
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[var(--fs-label)] font-medium" style={{ color: "#f97316", background: "rgba(249,115,22,.1)" }}>
                                等待确认
                            </span>
                        </div>
                        <div className="mt-1 text-xs leading-5" style={{ color: theme.node.text }}>
                            {friendlySummary}
                        </div>
                    </div>
                </div>
                {impact?.operationCount ? (
                    <div className="mt-3 pt-1">
                        <div className="grid grid-cols-4 gap-1">
                            <ImpactMetric label="操作" value={impact.operationCount} theme={theme} />
                            <ImpactMetric label="涉及节点" value={impact.affectedNodeCount} theme={theme} />
                            <ImpactMetric label="删除" value={impact.destructiveCount} attention={impact.destructiveCount > 0} theme={theme} />
                            <ImpactMetric label="生成" value={impact.generationCount} attention={impact.generationCount > 0} theme={theme} />
                        </div>
                        {impact.items.length ? (
                            <div className="mt-3 space-y-1.5">
                                {impact.items.map((item, index) => (
                                    <div key={`${item}-${index}`} className="flex gap-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                                        <span className="mt-2 size-1 shrink-0 rounded-full bg-current" />
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {impact.warning ? <div className="mt-3 rounded-md bg-amber-500/[.08] px-2.5 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{impact.warning}</div> : null}
                    </div>
                ) : null}
                {onReject || onApprove ? (
                    <div className="mt-2 flex gap-2">
                        <Button danger size="small" className="!h-8 flex-1" icon={<XCircle className="size-3.5" />} onClick={() => onReject?.()}>
                            暂不执行
                        </Button>
                        <Button size="small" className="!h-8 flex-1" icon={<CheckCircle2 className="size-3.5" />} style={{ borderColor: "rgba(22,163,74,.42)", color: "#16a34a", background: "transparent" }} onClick={() => onApprove?.()}>
                            确认执行
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function ImpactMetric({ label, value, attention = false, theme }: { label: string; value: number; attention?: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="px-1 py-1">
            <div className="text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                {label}
            </div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: attention ? "#d97706" : theme.node.text }}>
                {value}
            </div>
        </div>
    );
}

function agentImpactFromDetail(detail: unknown) {
    const impact = objectField(detail, "impact");
    if (!impact || typeof impact !== "object") return null;
    const value = impact as Partial<CloudAgentOperationImpact>;
    return {
        operationCount: Number(value.operationCount) || 0,
        affectedNodeCount: Number(value.affectedNodeCount) || 0,
        destructiveCount: Number(value.destructiveCount) || 0,
        generationCount: Number(value.generationCount) || 0,
        items: Array.isArray(value.items) ? value.items.filter((item): item is string => typeof item === "string") : [],
        warning: typeof value.warning === "string" ? value.warning : "",
    } satisfies CloudAgentOperationImpact;
}

export function AgentToolCard({ title, text, detail, theme, references = [], onFocusNode }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; references?: CanvasResourceReference[]; onFocusNode?: (nodeId: string) => void }) {
    const state = toolCardState(title, text, detail);
    const toolName = agentToolName(title, detail);
    const category = agentToolCategory(toolName, detail);
    const categoryLabel = agentToolCategoryLabel(toolName, category);
    const summary = friendlyAgentToolSummary(toolName, text, detail);
    const actions = agentCanvasActions(toolName, detail, references);
    const isNodeRead = toolName === "canvas_get_state" && category === "read";
    const [readExpanded, setReadExpanded] = useState(false);
    const visibleActions = actions.slice(0, isNodeRead && !readExpanded ? 1 : 8);
    const collapsedReadNodeCount = isNodeRead ? Math.max(0, actions.length - visibleActions.length) : 0;
    const isPlain = !actions.length && !state.isError;
    const conciseError = text.length > 180 ? `${text.slice(0, 180)}…` : text;
    const categoryIcon = category === "read" ? <Eye className="size-3.5" /> : category === "create" ? <Plus className="size-3.5" /> : <Pencil className="size-3.5" />;
    return (
        <div data-agent-tool-card className={`agent-tool-row agent-tool-row--${category}${isPlain ? " agent-tool-row--plain" : ""} flex min-w-0 flex-1 items-start gap-2.5 text-left`} style={{ color: theme.node.text }}>
            <span className="agent-tool-status shrink-0" style={{ color: state.color }} aria-hidden="true">{state.icon}</span>
            <div className="min-w-0 flex-1 break-words text-xs leading-5" style={{ color: state.isError ? state.color : theme.node.muted }}>
                <div className="agent-tool-header">
                    <span className="agent-tool-category">{categoryIcon}<span>{categoryLabel}</span></span>
                    <span className="agent-tool-summary">{summary}</span>
                    {state.label !== "已完成" ? <span className="agent-tool-label" style={{ color: state.color }}>{state.label}</span> : null}
                </div>
                {actions.length ? <div className="agent-tool-action-list">
                    {visibleActions.map((action) => <button key={`${action.action}-${action.nodeId}`} type="button" data-agent-node-id={action.nodeId} disabled={!onFocusNode} onClick={() => onFocusNode?.(action.nodeId)} aria-label={`在画布中定位${action.title}`} className="agent-tool-action-link">{agentCanvasActionLabel(action)}</button>)}
                    {isNodeRead && (collapsedReadNodeCount > 0 || readExpanded) ? (
                        <button type="button" className="agent-tool-more" aria-expanded={readExpanded} onClick={() => setReadExpanded((current) => !current)}>
                            {readExpanded ? `收起其余 ${Math.max(0, actions.length - 1)} 个节点` : `已折叠 ${collapsedReadNodeCount} 个节点，展开查看`}
                        </button>
                    ) : null}
                </div> : null}
                {state.isError && text && text !== summary ? <span className="mt-1 block whitespace-pre-wrap break-words" style={{ color: theme.node.muted }}>{conciseError}</span> : null}
                {state.isError && text.length > 180 ? <details className="mt-1" style={{ color: theme.node.muted }}><summary className="cursor-pointer">查看完整错误详情</summary><p className="whitespace-pre-wrap break-words">{text}</p></details> : null}
                {state.isError && objectField(objectField(detail, "result"), "taskId") ? <span className="mt-1 block break-all" style={{ color: theme.node.muted }}>任务 ID：{String(objectField(objectField(detail, "result"), "taskId"))}</span> : null}
            </div>
            {state.label === "已完成" ? <span className="sr-only">已完成</span> : null}
        </div>
    );
}

export function AgentWorkingMessage({ theme, label = WORKING_TEXT }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; label?: string }) {
    return (
        <div role="status" aria-live="polite" className="agent-working-indicator" style={{ color: theme.node.muted }}>
            <span className="agent-working-signal" aria-hidden="true"><span /></span>
            <span>{label}</span>
            <span className="agent-working-caption">实时处理中</span>
        </div>
    );
}

export function AgentPlanBar({ items, theme, minimized, onToggle }: {
    items: CloudAgentPlanItem[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    minimized: boolean;
    onToggle: () => void;
}) {
    const doneCount = items.filter((entry) => entry.status === "done").length;
    const allDone = doneCount === items.length;
    return (
        <div className="agent-plan-bar mx-3 mb-2 overflow-hidden rounded-xl" style={{ background: theme.node.fill, border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2" aria-expanded={!minimized} onClick={onToggle}>
                <ListChecks className="size-3.5 shrink-0" style={{ color: allDone ? "#429477" : theme.node.muted }} />
                <span className="text-xs font-semibold">本轮待办</span>
                <span className="text-[11px] tabular-nums opacity-50">{doneCount}/{items.length}</span>
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 text-[11px] opacity-50">{minimized ? "展开" : "收起"}</span>
                {minimized ? <ChevronDown className="size-3.5 shrink-0 opacity-50" /> : <ChevronUp className="size-3.5 shrink-0 opacity-50" />}
            </button>
            {minimized ? null : (
                <ul className="thin-scrollbar max-h-40 space-y-1 overflow-y-auto px-3 pb-2">
                    {items.map((entry) => {
                        const done = entry.status === "done";
                        const doing = entry.status === "doing";
                        const Icon = done ? CheckCircle2 : doing ? LoaderCircle : CircleDot;
                        return (
                            <li key={entry.id} className="flex min-w-0 items-start gap-1.5 text-xs">
                                <Icon className={doing ? "mt-[3px] size-3 shrink-0 animate-spin" : "mt-[3px] size-3 shrink-0"} style={{ color: done ? "#429477" : doing ? theme.accent.primary : theme.node.muted }} />
                                <span className={done ? "min-w-0 break-words line-through opacity-50" : "min-w-0 break-words"}>{entry.title}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export function AgentQuestionBar({ question, theme, onAnswer, disabled = false }: {
    question: CloudAgentUserQuestion;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onAnswer: (label: string) => void;
    disabled?: boolean;
}) {
    return (
        <div className="agent-question-bar mx-3 mb-2 overflow-hidden rounded-xl" style={{ background: theme.node.fill, border: `1px solid ${theme.accent.primary}`, color: theme.node.text }}>
            <div className="flex items-start gap-2 px-3 pt-2.5">
                <HelpCircle className="mt-[1px] size-3.5 shrink-0" style={{ color: theme.accent.primary }} />
                <span className="min-w-0 flex-1 text-xs font-semibold leading-5">{question.question}</span>
            </div>
            <div className="flex flex-wrap gap-2 px-3 pb-2 pt-2">
                {question.options.map((option) => (
                    <button
                        key={option.label}
                        type="button"
                        disabled={disabled}
                        title={option.detail || option.label}
                        className="max-w-full rounded-md border px-3 py-1.5 text-left text-xs transition focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onAnswer(option.label);
                        }}
                    >
                        <span className="block break-words font-medium">{option.label}</span>
                        {option.detail ? <span className="mt-0.5 block break-words text-[10px] leading-4 opacity-60">{option.detail}</span> : null}
                    </button>
                ))}
            </div>
            <div className="px-3 pb-2 text-[10px] opacity-50">
                {question.allowFreeform === false ? "请从上面选一项。" : "点一项即可，也可以在下方输入框里自己说明。"}
            </div>
        </div>
    );
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    running,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onAddFiles,
    onRemoveAttachment,
    left,
    onStop,
    stopping,
    references = [],
    slashSkills,
    includeAssetLibrary,
}: {
    prompt: string;
    attachments?: CloudAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    running?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void | Promise<void>;
    stopping?: boolean;
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
    const [previewAttachment, setPreviewAttachment] = useState<CloudAgentChatAttachment | null>(null);
    const [promptHeight, setPromptHeight] = useState(MIN_AGENT_PROMPT_HEIGHT);
    const promptResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const manualPromptHeightRef = useRef<number | null>(null);
    const availableSlashSkills = slashSkills ?? [];
    const slashCandidates = useMemo(() => {
        const query = slash?.query.trim().toLocaleLowerCase() || "";
        if (!query) return availableSlashSkills;
        return availableSlashSkills.filter((skill) => `${skill.skillName} ${skill.description || ""}`.toLocaleLowerCase().includes(query));
    }, [availableSlashSkills, slash?.query]);
    const attachmentReferences = useMemo(() => agentAttachmentReferences(attachments), [attachments]);
    const skillReferences = useMemo(() => buildSkillMentionReferences(availableSlashSkills), [availableSlashSkills]);
    const composerReferences = useMemo(() => [...references, ...skillReferences, ...attachmentReferences].filter((reference, index, all) => all.findIndex((item) => item.id === reference.id) === index), [attachmentReferences, references, skillReferences]);
    const canStop = Boolean(running && onStop);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const reducedMotion = useReducedMotion();
    const activeSlashIndex = Math.min(Math.max(slashIndex, 0), Math.max(slashCandidates.length - 1, 0));

    const handlePromptContentSizeChange = useCallback((naturalHeight: number) => {
        const nextHeight = clampAgentPromptHeight(naturalHeight);
        // 用户开始拖动后，面板高度由用户掌控；超出部分交给内部滚动区，
        // 避免输入新内容时又把手动缩小的面板强行撑开。
        setPromptHeight((currentHeight) => manualPromptHeightRef.current === null ? nextHeight : currentHeight);
    }, []);

    useEffect(() => {
        if (prompt.trim()) return;
        manualPromptHeightRef.current = null;
        setPromptHeight(MIN_AGENT_PROMPT_HEIGHT);
    }, [prompt]);

    const startPromptResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        event.preventDefault();
        manualPromptHeightRef.current = promptHeight;
        promptResizeRef.current = { startY: event.clientY, startHeight: promptHeight };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const resizePrompt = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const resize = promptResizeRef.current;
        if (!resize) return;
        setPromptHeight(clampAgentPromptHeight(resize.startHeight + resize.startY - event.clientY));
    };

    const finishPromptResize = (event?: ReactPointerEvent<HTMLButtonElement>) => {
        promptResizeRef.current = null;
        if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const resizePromptByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        manualPromptHeightRef.current = promptHeight;
        setPromptHeight(clampAgentPromptHeight(promptHeight + (event.key === "ArrowUp" ? 20 : -20)));
    };

    // 在输入值末尾检测「/ 或 、+ 关键词」打开技能候选：中文输入法下 "/" 会打成 "、"，两者等价，且都必须紧跟行首或空白，避免中文顿号误触发。选中后写入稳定 token，编辑器再把它渲染为技能 chip。
    const handlePromptChange = (value: string) => {
        onPromptChange(value);
        const match = /(^|\s)[/、]([^\s/、]*)$/.exec(value);
        if (match && availableSlashSkills.length) {
            const next = { start: match.index + match[1].length, query: match[2] };
            setSlash((current) => (current && current.start === next.start && current.query === next.query ? current : next));
            setSlashIndex(0);
        } else if (slash) {
            setSlash(null);
        }
    };

    const applySlashSkill = (skill: Skill) => {
        const token = `@[skill:${skill.skillId}] `;
        // 触发符 "/" 与 "、" 都是单字符，替换长度固定为 1。
        const next = slash ? `${prompt.slice(0, slash.start)}${token}${prompt.slice(slash.start + 1 + slash.query.length)}` : prompt ? `${prompt.replace(/\s+$/u, "")} ${token}` : token;
        setSlash(null);
        setSlashIndex(0);
        onPromptChange(next);
    };

    // slash 菜单的键盘控制在 capture 阶段拦截（contentEditable/textarea 内部先消费 Enter，外层冒泡拿不到）
    const handleSlashKeyCapture = (event: ReactKeyboardEvent) => {
        if (!slash || !slashCandidates.length) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.min(index + 1, slashCandidates.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            applySlashSkill(slashCandidates[activeSlashIndex]);
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

    const insertAttachmentMention = (item: CloudAgentChatAttachment) => {
        const token = `@[attachment:${item.id}] `;
        if (prompt.includes(`@[attachment:${item.id}]`)) return;
        onPromptChange(prompt ? `${prompt.replace(/\s+$/u, "")} ${token}` : token);
    };

    return (
        <div className="min-w-0 shrink-0 px-3 pb-3 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div
                className="group/composer relative rounded-2xl px-3 pb-2.5 pt-3 transition-[background-color,box-shadow] duration-200"
                style={{
                    background: theme.node.fill,
                    color: theme.accent.primary,
                    boxShadow: `0 16px 40px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,0.045)`,
                }}
            >
                {sending && !reducedMotion ? <WorkingGlow active color={theme.accent.primary} radius={22} /> : null}
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item, index) => (
                            <div key={item.id} className="group relative w-20 shrink-0">
                                <button
                                    type="button"
                                    className="relative block size-20 overflow-hidden rounded-lg"
                                    title="点击放大预览"
                                    aria-label={`预览 ${item.name || `图片${index + 1}`}`}
                                    onClick={() => setPreviewAttachment(item)}
                                    onDoubleClick={() => setPreviewAttachment(item)}
                                >
                                    <img src={item.url} alt={item.name} className="size-full object-cover" />
                                </button>
                                <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
                                    <button
                                        type="button"
                                        className="flex min-w-0 items-center gap-0.5 truncate text-[var(--fs-tiny)] opacity-80 hover:opacity-100"
                                        title={`插入 @图片${index + 1}`}
                                        onClick={() => insertAttachmentMention(item)}
                                    >
                                        <AtSign className="size-2.5 shrink-0" />
                                        <span className="truncate">图片{index + 1}</span>
                                    </button>
                                    {onRemoveAttachment ? (
                                        <button
                                            type="button"
                                            className="grid size-4 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"
                                            style={{ background: theme.toolbar.panel, color: theme.node.text }}
                                            onClick={() => onRemoveAttachment(item.id)}
                                            aria-label="移除图片"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="relative" onKeyDownCapture={handleSlashKeyCapture} onPasteCapture={handlePasteCapture}>
                    <button
                        type="button"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="调整提示词面板高度"
                        aria-valuemin={MIN_AGENT_PROMPT_HEIGHT}
                        aria-valuemax={MAX_AGENT_PROMPT_HEIGHT}
                        aria-valuenow={promptHeight}
                        className="agent-composer-resize-handle"
                        style={{ color: theme.node.muted }}
                        onPointerDown={startPromptResize}
                        onPointerMove={resizePrompt}
                        onPointerUp={finishPromptResize}
                        onPointerCancel={finishPromptResize}
                        onKeyDown={resizePromptByKeyboard}
                    >
                        <span />
                    </button>
                    <div className="agent-composer-prompt-scroll" style={{ height: promptHeight }}>
                        <CanvasResourceMentionTextarea
                            value={prompt}
                            references={composerReferences}
                            includeAssetLibrary={includeAssetLibrary}
                            sendOnEnter={canSubmit ? "both" : false}
                            disabled={disabled}
                            onChange={handlePromptChange}
                            onSubmit={() => { if (canSubmit) onSubmit(); }}
                            onContentSizeChange={handlePromptContentSizeChange}
                            className="w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                            containerClassName="min-h-[60px] h-full"
                            style={{ color: theme.node.text }}
                            placeholder={placeholder}
                            aria-label="Agent 输入"
                        />
                    </div>
                    {slash && slashCandidates.length ? (
                        <div
                            data-agent-slash-menu
                            className="absolute bottom-full left-0 z-[var(--z-toolbar)] mb-2 w-full max-w-xs overflow-hidden rounded-2xl p-1.5 shadow-2xl"
                            style={{ background: theme.toolbar.panel, boxShadow: `0 18px 44px ${theme.spatial.shadow}` }}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {slashCandidates.map((skill, index) => (
                                <button
                                    key={skill.skillId}
                                    type="button"
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                                    style={{ background: index === activeSlashIndex ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                    onMouseEnter={() => setSlashIndex(index)}
                                    onClick={() => applySlashSkill(skill)}
                                >
                                    <Sparkles className="size-3.5 shrink-0 opacity-70" />
                                    <span className="min-w-0 truncate font-medium">{skill.skillName}</span>
                                    {skill.description ? <span className="min-w-0 flex-1 truncate opacity-50">{skill.description}</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="agent-composer-toolbar mt-2">
                    <div className="agent-composer-controls flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    hidden
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(event) => {
                                        void onAddFiles(event.target.files);
                                        event.target.value = "";
                                    }}
                                />
                                <Tooltip title="上传图片">
                                    <Button
                                        type="text"
                                        shape="circle"
                                        className="!h-8 !w-8 !min-w-8 !transition-transform hover:!scale-105 active:!scale-95"
                                        disabled={sending}
                                        style={{ color: theme.node.muted }}
                                        icon={<ImagePlus className="size-4" />}
                                        onClick={() => fileInputRef.current?.click()}
                                    />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <div className="agent-composer-submit flex items-center gap-2">
                        {disabled ? null : (
                            <span className="agent-composer-send-hint">
                                <span className="agent-composer-send-hint-full">{canStop ? "运行中：发送即插话，下一步生效" : "Enter 发送 · Shift+Enter 换行"}</span>
                                <span className="agent-composer-send-hint-compact">{canStop ? "运行中可插话" : "Enter 发送"}</span>
                            </span>
                        )}
                        {canStop ? <motion.button
                            type="button"
                            disabled={stopping}
                            aria-label="停止本轮"
                            title="停止当前 Agent 运行"
                            onClick={() => void onStop?.()}
                            whileHover={!reducedMotion && !stopping ? { scale: 1.06, y: -1 } : undefined}
                            whileTap={!reducedMotion && !stopping ? { scale: 0.9, y: 1 } : undefined}
                            animate={stopping && !reducedMotion ? { scale: [1, 0.94, 1] } : { scale: 1 }}
                            transition={{ type: "spring", stiffness: 420, damping: 24 }}
                            className="grid size-9 shrink-0 place-items-center rounded-full p-0 outline-none transition-[background-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                            style={{ background: theme.accent.danger, color: theme.accent.onPrimary, boxShadow: `0 8px 20px ${theme.accent.danger}45` }}
                        >
                            {stopping ? <LoaderCircle className="size-4 animate-spin" /> : <Square className="size-3.5" fill="currentColor" />}
                        </motion.button> : null}
                        <motion.button
                            type="button"
                            disabled={!canSubmit}
                            aria-label={sending ? "发送中" : canStop ? "插话" : "发送"}
                            title={canStop ? "插话：Agent 下一次开口时看到它" : "点击发送；Enter 或 ⌘/Ctrl+Enter 发送"}
                            onClick={() => onSubmit()}
                            whileHover={canSubmit && !reducedMotion ? { scale: 1.06, y: -1 } : undefined}
                            whileTap={canSubmit && !reducedMotion ? { scale: 0.9, y: 1 } : undefined}
                            animate={stopping && !reducedMotion ? { scale: [1, 0.94, 1] } : { scale: 1, rotate: 0 }}
                            transition={sending && !reducedMotion ? { duration: 0.42, ease: "easeOut" } : { type: "spring", stiffness: 420, damping: 24 }}
                            className="grid size-9 shrink-0 place-items-center rounded-full p-0 outline-none transition-[background-color,box-shadow,color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                            style={{
                                background: canSubmit || sending ? theme.accent.primary : theme.spatial.surface,
                                color: canSubmit || sending ? theme.accent.onPrimary : theme.node.muted,
                                boxShadow: canSubmit || sending ? `0 8px 20px ${theme.accent.primary}45` : "none",
                            }}
                        >
                            <motion.span
                                key={stopping ? "stopping" : sending ? "sending" : "ready"}
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
            {previewAttachment ? <AgentImagePreview attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} /> : null}
        </div>
    );
}

export function AgentPanelTabs<T extends string>({
    value,
    items,
    theme,
    right,
    onChange,
}: {
    value: T;
    items: { value: T; label: string; icon?: ReactNode; count?: number }[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    right?: ReactNode;
    onChange: (value: T) => void;
}) {
    return (
        <div className="shrink-0 px-3 pb-1">
            <div className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-0.5 py-0.5" style={{ background: "transparent" }}>
                <nav className="grid min-w-0 flex-1 grid-flow-col auto-cols-fr items-center gap-0.5 text-[var(--fs-label)]" role="tablist" aria-label="Agent 面板">
                    {items.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={value === item.value}
                            className={`inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 transition-colors ${value === item.value ? "font-medium" : "font-normal"}`}
                            style={{ background: value === item.value ? theme.node.fill : "transparent", color: value === item.value ? theme.node.text : theme.node.muted, boxShadow: value === item.value ? `0 2px 8px ${theme.spatial.shadow}` : "none" }}
                            onClick={() => onChange(item.value)}
                        >
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

function AgentTimelineMarker({ theme, tone, icon }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; tone: "agent" | "muted" | "tool" | "approval" | "error"; icon?: ReactNode }) {
    const color = tone === "error" ? "#ef4444" : tone === "approval" ? "#f97316" : tone === "tool" ? "#4f7cff" : tone === "agent" ? theme.accent.primary : theme.node.muted;
    return (
        <span className="relative flex w-6 shrink-0 self-stretch justify-center" aria-hidden="true">
            <span className="relative grid size-6 place-items-center rounded-full" style={{ background: tone === "agent" ? theme.accent.primarySoft : theme.node.fill, color }}>
                {icon || <span className="size-3 opacity-90" style={{ background: color, WebkitMask: "url(/icons/openai.svg) center / contain no-repeat", mask: "url(/icons/openai.svg) center / contain no-repeat" }} />}
            </span>
        </span>
    );
}

function AgentMessageAttachments({ attachments }: { attachments: CloudAgentChatAttachment[] }) {
    const [preview, setPreview] = useState<CloudAgentChatAttachment | null>(null);
    return (
        <>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
                {attachments.map((item) => (
                    <button key={item.id} type="button" className="group relative overflow-hidden rounded-lg" onClick={() => setPreview(item)} onDoubleClick={() => setPreview(item)} aria-label={`查看图片 ${item.name}`}>
                        <img src={item.url} alt={item.name} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
                    </button>
                ))}
            </div>
            {preview ? <AgentImagePreview attachment={preview} onClose={() => setPreview(null)} /> : null}
        </>
    );
}

export function AgentImagePreview({ attachment, onClose }: { attachment: CloudAgentChatAttachment; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[var(--z-dialog-popover)] grid place-items-center bg-black/80 p-6" role="dialog" aria-label={attachment.name} onClick={onClose}>
            <img src={attachment.url} alt={attachment.name} className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
            <button type="button" className="absolute right-5 top-5 rounded-full bg-black/60 p-2 text-white" onClick={onClose} aria-label="关闭图片预览">
                <X className="size-5" />
            </button>
        </div>
    );
}

function agentAttachmentReferences(attachments: CloudAgentChatAttachment[]): CanvasResourceReference[] {
    return attachments.map((item, index) => ({
        id: `attachment:${item.id}`,
        nodeId: "",
        kind: "image",
        label: `图片${index + 1}`,
        title: item.name || `图片${index + 1}`,
        previewUrl: item.url,
        active: true,
        mentionToken: `@[attachment:${item.id}]`,
    }));
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const status = agentToolStatus(title, text, detail);
    if (status === "completed") return { label: "已完成", color: "#16a34a", softBg: "rgba(22,163,74,.04)", icon: <CheckCircle2 className="size-4" />, isError: false };
    if (status === "failed") return { label: "执行失败", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (status === "noop") return { label: "未生效", color: "#d97706", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (status === "rejected") return { label: "拒绝执行", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    return { label: "处理中", color: "#64748b", softBg: "rgba(100,116,139,.04)", icon: <CircleDot className="size-4" />, isError: false };
}

function agentToolName(title: string, detail?: unknown) {
    return String(objectField(detail, "toolName") || objectField(detail, "name") || objectField(detail, "tool") || title);
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
