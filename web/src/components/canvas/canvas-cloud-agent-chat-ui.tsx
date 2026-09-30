import { agentCanvasActions, agentCanvasActionLabel } from "@/lib/canvas/agent-canvas-actions";
import { Button } from "antd";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from "react";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, CircleDot, Eye, HelpCircle, List, ListChecks, LoaderCircle, Pencil, Plus, RotateCcw, Sparkles, Wrench, XCircle } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Components } from "streamdown";
import { agentToolCategory, agentToolCategoryLabel, agentToolErrorClassLabel, agentToolName, agentToolRetryLabel, agentToolStatus, friendlyAgentToolSummary, type AgentToolCategory } from "@/lib/canvas/agent-tool-presentation";
import { agentOperationCategory, agentOperationFailed, agentOperationSegmentLabel } from "@/lib/canvas/agent-operation-feed";
import { agentToolRetry, type AgentToolRetryAttempt } from "@/lib/canvas/agent-tool-retry";
import { AgentImagePreview } from "./canvas-cloud-agent-composer";

// 输入区已拆到 canvas-cloud-agent-composer.tsx；附件类型与引用转换在 canvas-cloud-agent-attachments.ts。
// 这里保留再导出，既有 import 路径保持可用。
import { agentAttachmentReferences, type CloudAgentChatAttachment } from "./canvas-cloud-agent-attachments";
export { agentAttachmentReferences, type CloudAgentChatAttachment } from "./canvas-cloud-agent-attachments";
export { AGENT_SCENE_DEFS, AgentChatComposer, AgentImagePreview, AgentSceneCapsules, type AgentSceneBucket } from "./canvas-cloud-agent-composer";

type CloudAgentOperationImpact = {
    operationCount: number;
    affectedNodeCount: number;
    destructiveCount: number;
    generationCount: number;
    items: string[];
    warning?: string;
};
export type CloudAgentPlanItem = { id: string; title: string; status: "pending" | "doing" | "done" };
export type CloudAgentFormOption = { id?: string; label: string; detail?: string; recommended?: boolean };
export type CloudAgentFormField = {
    id: string;
    title: string;
    type: "single_select" | "segmented" | "text" | "textarea" | "model_picker";
    options?: CloudAgentFormOption[];
    defaultValue?: string;
    required?: boolean;
    allowCustom?: boolean;
    placeholder?: string;
};
export type CloudAgentUserQuestion = {
    question: string;
    options: Array<{ label: string; detail?: string }>;
    fields?: CloudAgentFormField[];
    kind?: "choice" | "form";
    questionId?: string;
    allowFreeform?: boolean;
    round?: number;
    maxRounds?: number;
};
export type CloudAgentFormAnswer = {
    type: "form_answer";
    questionId?: string;
    answers: Record<string, string>;
    displayAnswers?: Record<string, string>;
    fieldTitles?: Record<string, string>;
    skippedFields?: string[];
    useRecommendedDefaults?: boolean;
};
export type CloudAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    errorSeverity?: "warning" | "error";
    streaming?: boolean;
    reasoning?: boolean;
    /**
     * 本轮最终答复（服务端收尾闸门的结论）。false 表示这是过程正文——模型边做边说的那一段，
     * 不是结论：运行还在继续，或者这次收尾被闸门拦下了。缺省按 true 处理（老后端没有这个字段）。
     * 界面不再为它单独出角标（用户口径），但标记仍如实保存。
     */
    final?: boolean;
    planItems?: CloudAgentPlanItem[];
    /** 运行已进入终态，但计划项仍未全部完成；用于历史恢复时停止显示 loading。 */
    planTerminal?: boolean;
    question?: CloudAgentUserQuestion;
    formAnswer?: CloudAgentFormAnswer;
    meta?: string;
    detail?: unknown;
    attachments?: CloudAgentChatAttachment[];
    interjection?: "sent" | "undelivered";
};

/**
 * 助手正文的收尾语义（工作项 A）：final=false 是过程说明，true / 缺省是结论。
 * 缺省按"结论"处理是为了兼容升级前的后端事件——那时所有正文都按最终正文展示。
 */
export function agentAssistantFinality(payload: Record<string, unknown>): boolean {
    return payload.final !== false;
}

/**
 * 服务端控制消息（例如运行时的收尾闸门 `completion_blocked`）在时间线里的表示：
 * 它是服务端说明，不是用户发言，所以走 system 行——绝不能渲染成真人 user 气泡。
 */
export function agentControlMessage(id: string, text: string, meta?: string): CloudAgentChatMessage {
    return { id, role: "system", text, meta };
}

const AGENT_FORM_FIELD_LABELS: Record<string, string> = {
    genre: "题材",
    aspectRatio: "画幅",
    style: "画风",
    visualStyle: "画风",
    comedyStyle: "喜剧风格",
    projectType: "项目类型",
    model: "模型",
    notes: "补充说明",
};

const AGENT_FORM_VALUE_LABELS: Record<string, string> = {
    costume_time_travel: "古装穿越",
    absurd: "荒诞",
};

function formAnswerRecord(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const entries = Object.entries(value).filter(([, item]) => typeof item === "string" && item.trim());
    return entries.length ? Object.fromEntries(entries.map(([key, item]) => [key, String(item)])) : undefined;
}

export function parseCloudAgentFormAnswer(value: string): CloudAgentFormAnswer | undefined {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as { type?: unknown }).type !== "form_answer") return undefined;
        const record = parsed as Record<string, unknown>;
        if (!record.answers || typeof record.answers !== "object" || Array.isArray(record.answers)) return undefined;
        const answers = formAnswerRecord(record.answers) || {};
        return {
            type: "form_answer",
            questionId: typeof record.questionId === "string" ? record.questionId : undefined,
            answers,
            displayAnswers: formAnswerRecord(record.displayAnswers),
            fieldTitles: formAnswerRecord(record.fieldTitles),
            skippedFields: Array.isArray(record.skippedFields) ? record.skippedFields.filter((item): item is string => typeof item === "string") : [],
            useRecommendedDefaults: record.useRecommendedDefaults === true,
        };
    } catch {
        return undefined;
    }
}

function agentFormFieldLabel(key: string, fieldTitles?: Record<string, string>) {
    return fieldTitles?.[key] || AGENT_FORM_FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function agentFormValueLabel(value: string) {
    return AGENT_FORM_VALUE_LABELS[value] || value.replace(/_/g, " ");
}

function AgentFormAnswerCard({ answer, theme }: { answer: CloudAgentFormAnswer; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const values = answer.displayAnswers && Object.keys(answer.displayAnswers).length ? answer.displayAnswers : answer.answers;
    const entries = Object.entries(values).filter(([, value]) => value.trim());
    return (
        <div className="agent-form-answer-card" style={{ color: theme.node.text }}>
            <div className="agent-form-answer-heading">已确认创作方向</div>
            {answer.useRecommendedDefaults ? <div className="agent-form-answer-note">已采用推荐方案</div> : null}
            {entries.length ? (
                <div className="agent-form-answer-list">
                    {entries.map(([key, value]) => (
                        <div className="agent-form-answer-row" key={key}>
                            <span className="agent-form-answer-label">{agentFormFieldLabel(key, answer.fieldTitles)}</span>
                            <span className="agent-form-answer-value">{answer.displayAnswers?.[key] || agentFormValueLabel(value)}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="agent-form-answer-note">已确认，按推荐方案继续</div>
            )}
        </div>
    );
}

/**
 * 类别的图标语言：三档互不串味 —— 清单用 List（读到存在与规模）、画面用 Eye（图片字节真的
 * 交给了模型）、写画布用 Pencil / 创建用 Plus；未登记的工具走中性的 Wrench。
 */
function agentToolCategoryIcon(category: AgentToolCategory) {
    if (category === "vision") return <Eye className="size-3.5" />;
    if (category === "read") return <List className="size-3.5" />;
    if (category === "create") return <Plus className="size-3.5" />;
    if (category === "operate") return <Pencil className="size-3.5" />;
    return <Wrench className="size-3.5" />;
}

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
const AGENT_NODE_LINK_PREFIX = "#agent-node:";
const AGENT_NODE_TYPE_LABELS: Record<string, string> = {
    image: "图片节点",
    video: "视频节点",
    audio: "音频节点",
    text: "文本节点",
    script: "脚本节点",
    drawing: "绘图节点",
    config: "工作流节点",
    frame: "画框节点",
    markdown: "Markdown 节点",
    svg: "SVG 节点",
    html: "HTML 节点",
    panorama: "全景节点",
    compare: "对比节点",
    chart: "图表节点",
    colorgrade: "调色节点",
    "media-conversion": "转码节点",
    "batch-table": "批量表节点",
};
const AGENT_NODE_TYPE_PREFIXES = Object.keys(AGENT_NODE_TYPE_LABELS).sort((left, right) => right.length - left.length);
const BUILTIN_AGENT_NODE_ID_PATTERN = "(?:image|video|audio|text|script|drawing|config|frame|markdown|svg|html|panorama|compare|chart|colorgrade|media-conversion|batch-table)-[A-Za-z0-9][A-Za-z0-9_-]*";

function escapeAgentNodePattern(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function agentNodeTypeLabel(nodeId: string, reference?: CanvasResourceReference) {
    const sourceType = String(reference?.sourceType || "");
    if (sourceType && AGENT_NODE_TYPE_LABELS[sourceType]) return AGENT_NODE_TYPE_LABELS[sourceType];
    const prefix = AGENT_NODE_TYPE_PREFIXES.find((candidate) => nodeId.startsWith(`${candidate}-`));
    return (prefix && AGENT_NODE_TYPE_LABELS[prefix]) || (reference?.kind ? `${reference.kind} 节点` : "画布节点");
}

function agentNodeLinkLabel(nodeId: string, reference?: CanvasResourceReference) {
    const kindLabel = agentNodeTypeLabel(nodeId, reference);
    const title = (reference?.title || reference?.label || "").replace(/\s+/gu, " ").trim();
    return title ? `${kindLabel} · ${title}` : kindLabel;
}

function escapeAgentMarkdownLinkText(value: string) {
    return value.replace(/[\\[\]]/gu, "\\$&");
}

function createAgentNodeLink(nodeId: string, reference?: CanvasResourceReference) {
    return `[${escapeAgentMarkdownLinkText(agentNodeLinkLabel(nodeId, reference))}](${AGENT_NODE_LINK_PREFIX}${encodeURIComponent(nodeId)})`;
}

/**
 * Replace internal canvas node IDs in assistant Markdown with semantic links.
 * Fenced code is left untouched, while the historical "新节点 ID" wording is
 * shortened so the assistant exposes a node card instead of an implementation ID.
 */
export function rewriteAgentNodeLinks(text: string, references: CanvasResourceReference[] = []) {
    if (!text) return text;

    const referenceByNodeId = new Map(references.filter((reference) => reference.nodeId).map((reference) => [reference.nodeId, reference]));
    const exactNodeIds = [...referenceByNodeId.keys()].sort((left, right) => right.length - left.length).map(escapeAgentNodePattern);
    const nodeIdPattern = exactNodeIds.length ? `(?:${exactNodeIds.join("|")}|${BUILTIN_AGENT_NODE_ID_PATTERN})` : BUILTIN_AGENT_NODE_ID_PATTERN;
    const nodeTokenPattern = new RegExp(`(?<![A-Za-z0-9_-])(?:\\x60(${nodeIdPattern})\\x60|(${nodeIdPattern}))(?![A-Za-z0-9_-])`, "gu");
    const newNodePrefixPattern = /(新节点|节点|新建节点)\s*ID(?=\s*[：:])/gu;
    let inFence = false;

    return text
        .split(/(\r?\n)/u)
        .map((part) => {
            if (/^\r?\n$/u.test(part)) return part;
            const fence = /^\s{0,3}(`{3,}|~{3,})/u.test(part);
            if (fence) {
                inFence = !inFence;
                return part;
            }
            if (inFence) return part;

            const normalized = part.replace(newNodePrefixPattern, "$1");
            return normalized.replace(nodeTokenPattern, (match, backtickedId: string | undefined, plainId: string | undefined) => {
                const nodeId = backtickedId || plainId;
                return nodeId ? createAgentNodeLink(nodeId, referenceByNodeId.get(nodeId)) : match;
            });
        })
        .join("");
}

function agentNodeIdFromHref(href?: string) {
    if (!href?.startsWith(AGENT_NODE_LINK_PREFIX)) return null;
    try {
        const nodeId = decodeURIComponent(href.slice(AGENT_NODE_LINK_PREFIX.length));
        return nodeId || null;
    } catch {
        return null;
    }
}

function createAgentMessageMarkdownComponents(references: CanvasResourceReference[], onFocusNode?: (nodeId: string) => void): Components {
    const referenceByNodeId = new Map(references.filter((reference) => reference.nodeId).map((reference) => [reference.nodeId, reference]));
    return {
        a: ({ children, href, className, ...props }) => {
            const nodeId = agentNodeIdFromHref(href);
            if (!nodeId) {
                return (
                    <a {...props} href={href} className={`ai-message-markdown-link ${className || ""}`.trim()} target="_blank" rel="noreferrer">
                        {children}
                    </a>
                );
            }

            const reference = referenceByNodeId.get(nodeId);
            const title = reference?.title || reference?.label || "画布节点";
            const previewUrl = reference?.previewUrl;
            return (
                <a
                    {...props}
                    href={href}
                    className="agent-message-node-link"
                    data-agent-node-id={nodeId}
                    aria-label={`定位到画布中的${title}`}
                    title={`定位到画布中的${title}`}
                    onClick={(event) => {
                        event.preventDefault();
                        onFocusNode?.(nodeId);
                    }}
                >
                    {previewUrl ? (
                        <img className="agent-message-node-link-preview" src={previewUrl} alt="" loading="lazy" />
                    ) : (
                        <span className="agent-message-node-link-icon" aria-hidden="true">
                            <CircleDot className="size-3.5" />
                        </span>
                    )}
                    <span className="agent-message-node-link-copy">
                        <span className="agent-message-node-link-kind">{agentNodeTypeLabel(nodeId, reference)}</span>
                        <span className="agent-message-node-link-title">{reference?.title || reference?.label || children}</span>
                    </span>
                </a>
            );
        },
    };
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
    const displayedText = useTypewriterText(item.text, item.role === "assistant" && isStreaming);
    const formAnswer = item.formAnswer ?? (isUser ? parseCloudAgentFormAnswer(item.text) : undefined);
    const markdownComponents = useMemo(() => createAgentMessageMarkdownComponents(references, onFocusNode), [onFocusNode, references]);
    const agentMarkdownText = rewriteAgentNodeLinks(displayedText, references);
    const errorTone = item.errorSeverity === "warning" ? "warning" : "error";
    const color = item.role === "error" ? (errorTone === "warning" ? "#b45309" : "#ef4444") : theme.node.text;
    if (item.reasoning) {
        return <AgentReasoningFeed items={[item]} theme={theme} />;
    }
    if (isSystem) {
        return (
            <div className="agent-status-message agent-status-message--system flex items-start gap-2 text-xs">
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
            <div className={`agent-status-message agent-status-message--${errorTone} flex items-start gap-2`}>
                <AgentTimelineMarker theme={theme} tone={errorTone} icon={errorTone === "warning" ? <CircleAlert className="size-3.5" /> : <CircleAlert className="size-3.5" />} />
                <div className="min-w-0 flex-1 py-0.5 text-[13px] leading-5">
                    <div className="agent-error-title font-medium" style={{ color }}>
                        {item.title || (errorTone === "warning" ? "Agent 正在重试" : "Agent 暂时无法继续")}
                    </div>
                    <div className="agent-error-detail whitespace-pre-wrap break-words" style={{ color: theme.node.muted }}>
                        {item.text}
                    </div>
                    {item.meta ? (
                        <div className="agent-error-meta text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            {item.meta}
                        </div>
                    ) : null}
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
            <div className={`agent-message-body min-w-0 text-sm leading-6 ${isUser ? "agent-message-user max-w-[82%] px-4 py-3 text-right" : "max-w-full flex-1 text-left"}`} style={{ color }}>
                {item.interjection ? (
                    <span
                        className="mb-1 inline-flex items-center rounded-full px-1.5 py-[1px] text-[var(--fs-label)] leading-4"
                        style={item.interjection === "undelivered" ? { background: `${theme.accent.danger}22`, color: theme.accent.danger } : { background: "rgba(255,255,255,0.16)", opacity: 0.72 }}
                    >
                        {item.interjection === "undelivered" ? "插话未送达" : "插话"}
                    </span>
                ) : null}
                {item.role === "assistant" ? (
                    <AIMessageMarkdown className="text-left" isStreaming={isStreaming} streamingAnimation="none" components={markdownComponents}>
                        {agentMarkdownText}
                    </AIMessageMarkdown>
                ) : formAnswer ? (
                    <AgentFormAnswerCard answer={formAnswer} theme={theme} />
                ) : (
                    <AgentMessageText text={item.text} references={references} />
                )}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} /> : null}
                {item.meta ? <div className="mt-1 text-[var(--fs-label)] opacity-45">{item.meta}</div> : null}
            </div>
        </div>
    );
}

/**
 * 推理是辅助信息，不应与正文和工具输出争夺主视觉。一个事件流里的连续摘要
 * 合并成一个入口，默认收起；需要排查时再展开查看完整内容。
 */
export function AgentReasoningFeed({ items, theme }: { items: CloudAgentChatMessage[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const streaming = items.some((item) => item.streaming);
    const text = items
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join("\n\n");
    const countLabel = items.length > 1 ? `${items.length} 段 · ` : "";
    return (
        <div className="agent-reasoning" style={{ "--agent-reasoning-accent": theme.accent.primary } as CSSProperties}>
            <details className={`agent-reasoning-card${streaming ? " is-streaming" : ""}`}>
                <summary className="agent-reasoning-summary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/20">
                    <span className="agent-reasoning-copy">
                        <span className="agent-reasoning-title">{streaming ? "模型正在思考" : "模型思考"}</span>
                        <span className="agent-reasoning-subtitle">{streaming ? "实时整理 · 点击查看" : `${countLabel}点击查看`}</span>
                    </span>
                    <span className={`agent-reasoning-status${streaming ? " is-live" : ""}`}>
                        {streaming ? <span className="agent-reasoning-status-dot" aria-hidden="true" /> : null}
                        {streaming ? "实时" : "查看"}
                    </span>
                    <ChevronDown className="agent-reasoning-chevron" aria-hidden="true" />
                </summary>
                <div className="agent-reasoning-content" data-canvas-wheel-scroll>
                    <div className="agent-reasoning-text">{text || (streaming ? "正在整理思路…" : "暂无可展示的推理摘要")}</div>
                </div>
            </details>
        </div>
    );
}

/**
 * Agent SSE events contain text chunks. Keep the full text in the message
 * state, but reveal one code point at a time so a chunk never appears as a
 * whole block. The loop continues briefly after the stream ends to drain any
 * text that was buffered by the network.
 */
function useTypewriterText(targetText: string, shouldAnimate: boolean) {
    const targetRef = useRef(targetText);
    const visibleRef = useRef(shouldAnimate ? "" : targetText);
    const hasAnimatedRef = useRef(shouldAnimate);
    const runningRef = useRef(false);
    const timerRef = useRef<number | null>(null);
    const [visibleText, setVisibleText] = useState(visibleRef.current);

    targetRef.current = targetText;

    const startLoop = useCallback(() => {
        if (runningRef.current) return;
        runningRef.current = true;

        const step = () => {
            const target = targetRef.current;
            const targetCharacters = Array.from(target);
            const visibleCharacters = Array.from(visibleRef.current);
            const visibleIsPrefix = target.startsWith(visibleRef.current);

            if (!visibleIsPrefix || visibleCharacters.length > targetCharacters.length) {
                visibleRef.current = "";
                setVisibleText("");
            }

            const currentCharacters = Array.from(visibleRef.current);
            if (currentCharacters.length >= targetCharacters.length) {
                runningRef.current = false;
                timerRef.current = null;
                return;
            }

            const nextText = targetCharacters.slice(0, currentCharacters.length + 1).join("");
            visibleRef.current = nextText;
            setVisibleText(nextText);
            timerRef.current = window.setTimeout(step, 16);
        };

        step();
    }, []);

    useEffect(() => {
        if (shouldAnimate) hasAnimatedRef.current = true;
        if (!hasAnimatedRef.current && !shouldAnimate) {
            visibleRef.current = targetText;
            setVisibleText(targetText);
            return;
        }
        startLoop();
    }, [shouldAnimate, startLoop, targetText]);

    useEffect(
        () => () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            runningRef.current = false;
        },
        [],
    );

    return visibleText;
}

function AgentMessageText({ text, references }: { text: string; references: CanvasResourceReference[] }) {
    const parts = splitAgentMessageMentions(text, references);
    return (
        <div className="whitespace-pre-wrap break-words text-left">
            {parts.map((part, index) =>
                part.reference ? (
                    <span key={`${part.token}-${index}`} className="agent-message-mention" title={part.reference.title || part.reference.label}>
                        <span aria-hidden="true" className="agent-message-mention-icon">
                            {part.reference.kind === "skill" ? "✦" : "@"}
                        </span>
                        <span>{part.reference.label}</span>
                    </span>
                ) : (
                    <span key={`${part.text}-${index}`}>{part.text}</span>
                ),
            )}
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
        <div className="agent-status-message flex items-start gap-2">
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

export function AgentToolCard({
    title,
    text,
    detail,
    theme,
    references = [],
    onFocusNode,
}: {
    title: string;
    text: string;
    detail?: unknown;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    references?: CanvasResourceReference[];
    onFocusNode?: (nodeId: string) => void;
}) {
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
    const categoryIcon = agentToolCategoryIcon(category);
    const retry = agentToolRetry(detail);
    const attempts = objectField(detail, "retryAttempts");
    if (retry && Array.isArray(attempts)) {
        const label = agentToolRetryLabel(retry);
        return (
            <details data-agent-tool-retry className="min-w-0 flex-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                <summary className="cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2" style={{ outlineColor: theme.node.muted }}>
                    {retry.status === "recovered" ? `${label} · 已恢复` : `${label} · ${retry.attempt}/${retry.maxAttempts} 次尝试未通过`}
                </summary>
                <ol className="mt-2 space-y-1 pl-4" aria-label="自动纠正详情">
                    {(attempts as AgentToolRetryAttempt[]).map((attempt, index) => (
                        <li key={attempt.id} className="whitespace-pre-wrap break-words">
                            第 {index + 1} 次：{attempt.text}
                        </li>
                    ))}
                </ol>
            </details>
        );
    }
    return (
        <div data-agent-tool-card className={`agent-tool-row agent-tool-row--${category}${isPlain ? " agent-tool-row--plain" : ""} flex min-w-0 flex-1 items-start gap-2.5 text-left`} style={{ color: theme.node.text }}>
            <span className="agent-tool-status shrink-0" style={{ color: state.color }} aria-hidden="true">
                {state.icon}
            </span>
            <div className="min-w-0 flex-1 break-words text-xs leading-5" style={{ color: state.isError ? state.color : theme.node.muted }}>
                <div className="agent-tool-header">
                    <span className="agent-tool-category">
                        {categoryIcon}
                        <span>{categoryLabel}</span>
                    </span>
                    <span className="agent-tool-summary">{summary}</span>
                    {state.label !== "已完成" ? (
                        <span className="agent-tool-label" style={{ color: state.color }}>
                            {state.label}
                        </span>
                    ) : null}
                </div>
                {actions.length ? (
                    <div className="agent-tool-action-list">
                        {visibleActions.map((action) => (
                            <button
                                key={`${action.action}-${action.nodeId}`}
                                type="button"
                                data-agent-node-id={action.nodeId}
                                disabled={!onFocusNode}
                                onClick={() => onFocusNode?.(action.nodeId)}
                                aria-label={`在画布中定位${action.title}`}
                                className="agent-tool-action-link"
                            >
                                {agentCanvasActionLabel(action)}
                            </button>
                        ))}
                        {isNodeRead && (collapsedReadNodeCount > 0 || readExpanded) ? (
                            <button type="button" className="agent-tool-more" aria-expanded={readExpanded} onClick={() => setReadExpanded((current) => !current)}>
                                {readExpanded ? `收起其余 ${Math.max(0, actions.length - 1)} 个节点` : `另有 ${collapsedReadNodeCount} 个节点只是清单（未查看画面），展开查看`}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                {state.isError && text && text !== summary ? (
                    <span className="mt-1 block whitespace-pre-wrap break-words" style={{ color: theme.node.muted }}>
                        {conciseError}
                    </span>
                ) : null}
                {state.isError && text.length > 180 ? (
                    <details className="mt-1" style={{ color: theme.node.muted }}>
                        <summary className="cursor-pointer">查看完整错误详情</summary>
                        <p className="whitespace-pre-wrap break-words">{text}</p>
                    </details>
                ) : null}
                {state.isError && objectField(objectField(detail, "result"), "taskId") ? (
                    <span className="mt-1 block break-all" style={{ color: theme.node.muted }}>
                        任务 ID：{String(objectField(objectField(detail, "result"), "taskId"))}
                    </span>
                ) : null}
            </div>
            {state.label === "已完成" ? <span className="sr-only">已完成</span> : null}
        </div>
    );
}

/**
 * Agent 的操作记录（连续的 `role === "tool"` 消息）折成一行：报最新一步，点击展开完整记录。
 *
 * 语义要点：折叠态整段只有这一行可见，所以**类别徽标必须在折叠行上**（清单 / 查看画面 /
 * 修改画布），否则默认状态看不出刚才到底是读了清单还是真看了画面。
 *
 * 展开状态用「用户覆盖 + 失败时默认展开」两段决定 —— 失败的操作不能被折进一行里看不见，
 * 但用户手动收起之后就不再自动弹开（跑动中新步骤只会追加，不会重置状态）。
 * `live` 由面板按"这一段是不是对话末尾且在跑"给出：只有还在推进时才流光。
 */
export function AgentOperationFeed({
    items,
    theme,
    references = [],
    onFocusNode,
    live = false,
}: {
    items: CloudAgentChatMessage[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    references?: CanvasResourceReference[];
    onFocusNode?: (nodeId: string) => void;
    live?: boolean;
}) {
    const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
    const reducedMotion = useReducedMotion();
    const listId = useId();
    const latest = items[items.length - 1];
    if (!latest) return null;
    const category = agentOperationCategory(latest);
    const categoryLabel = agentToolCategoryLabel(agentToolName(latest.title || "工具执行", latest.detail), category);
    const categoryIcon = agentToolCategoryIcon(category);
    const label = agentOperationSegmentLabel(items);
    // 只看最新一步的状态。前面的参数错误如果已被自动纠正，不应让整段
    // 操作流继续保持红色并默认展开，否则用户会误以为最终动作仍然失败。
    const failed = agentOperationFailed(latest);
    const expanded = userExpanded ?? failed;
    const shimmering = live && !failed;
    return (
        <div className={`agent-operation-feed${expanded ? " is-open" : ""}${failed ? " is-failed" : ""}${shimmering ? " is-live" : ""}`} data-agent-operation-feed data-agent-category={category}>
            <button
                type="button"
                className="agent-operation-toggle"
                aria-expanded={expanded}
                aria-controls={listId}
                // aria-label 会顶掉可见文字，所以类别与最新一步必须自己报出来。
                aria-label={`${expanded ? "收起" : "展开"} ${items.length} 步${categoryLabel}记录，最新一步：${label}`}
                onClick={() => setUserExpanded(!expanded)}
            >
                <span className="agent-operation-icon" aria-hidden="true">
                    {categoryIcon}
                </span>
                <span className="agent-operation-kind">
                    <span>{categoryLabel}</span>
                </span>
                {/* 换步时旧文案高模糊淡出、新文案从下方上浮（先快后慢的非线性曲线）。 */}
                <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                        key={label}
                        className="agent-operation-latest"
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(6px)" }}
                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(8px)" }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                    >
                        {label}
                    </motion.span>
                </AnimatePresence>
                {items.length > 1 ? <span className="agent-operation-count">{items.length} 步</span> : null}
                <ChevronDown className="agent-operation-chevron" aria-hidden="true" />
            </button>
            {expanded ? (
                <div id={listId} className="agent-operation-list">
                    {items.map((item) => (
                        <AgentChatMessage key={item.id} item={item} theme={theme} references={references} onFocusNode={onFocusNode} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function AgentWorkingMessage({ theme, label = WORKING_TEXT }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; label?: string }) {
    return (
        <div role="status" aria-live="polite" className="agent-working-indicator" style={{ color: theme.node.muted }}>
            <span className="agent-working-signal" aria-hidden="true">
                <span />
            </span>
            <span>{label}</span>
            <span className="agent-working-caption">实时处理中</span>
        </div>
    );
}

export function AgentPlanBar({
    items,
    theme,
    minimized,
    onToggle,
    terminal: runEnded = false,
    waitingUser = false,
}: {
    items: CloudAgentPlanItem[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    minimized: boolean;
    onToggle: () => void;
    terminal?: boolean;
    /** 本轮停在 ask_user 等用户拍板：清单是暂停，不是停止。 */
    waitingUser?: boolean;
}) {
    const doneCount = items.filter((entry) => entry.status === "done").length;
    const allDone = doneCount === items.length;
    const terminal = runEnded && !waitingUser;
    return (
        <div className="agent-plan-bar mx-3 mb-2 overflow-hidden rounded-xl" style={{ color: theme.node.text }}>
            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2" aria-expanded={!minimized} onClick={onToggle}>
                <ListChecks className="size-3.5 shrink-0" style={{ color: allDone ? "#429477" : theme.node.muted }} />
                <span className="text-xs font-semibold">本轮待办</span>
                <span className="text-[11px] tabular-nums opacity-50">
                    {doneCount}/{items.length}
                </span>
                {waitingUser && !allDone ? <span className="shrink-0 text-[10px] opacity-55">等待你确认后继续</span> : null}
                {terminal && !allDone ? <span className="shrink-0 text-[10px] opacity-55">本轮已结束，未完成项已停止</span> : null}
                <span className="min-w-0 flex-1" />
                <span className="shrink-0 text-[11px] opacity-50">{minimized ? "展开" : "收起"}</span>
                {minimized ? <ChevronDown className="size-3.5 shrink-0 opacity-50" /> : <ChevronUp className="size-3.5 shrink-0 opacity-50" />}
            </button>
            {minimized ? null : (
                <ul className="thin-scrollbar max-h-40 space-y-1 overflow-y-auto px-3 pb-2">
                    {items.map((entry) => {
                        const done = entry.status === "done";
                        const doing = entry.status === "doing";
                        const Icon = done ? CheckCircle2 : terminal ? CircleAlert : doing ? LoaderCircle : CircleDot;
                        return (
                            <li key={entry.id} className="flex min-w-0 items-start gap-1.5 text-xs">
                                <Icon
                                    className={doing && !terminal && !waitingUser ? "mt-[3px] size-3 shrink-0 animate-spin" : "mt-[3px] size-3 shrink-0"}
                                    style={{ color: done ? "#429477" : terminal ? theme.node.muted : doing ? theme.accent.primary : theme.node.muted }}
                                />
                                <span className={done ? "min-w-0 break-words line-through opacity-50" : terminal ? "min-w-0 break-words opacity-55" : "min-w-0 break-words"}>{entry.title}</span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export function AgentQuestionBar({ question, theme, onAnswer, disabled = false }: { question: CloudAgentUserQuestion; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onAnswer: (answer: string) => void; disabled?: boolean }) {
    const fields = question.fields || [];
    const isForm = question.kind === "form" || fields.length > 0;
    const fieldDefaultValue = (field: CloudAgentFormField) => field.defaultValue || field.options?.find((option) => option.recommended)?.id || field.options?.find((option) => option.recommended)?.label || "";
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.id, fieldDefaultValue(field)])));
    const [customFields, setCustomFields] = useState<Record<string, boolean>>({});
    const [validation, setValidation] = useState("");

    useEffect(() => {
        setValues(Object.fromEntries(fields.map((field) => [field.id, fieldDefaultValue(field)])));
        setCustomFields({});
        setValidation("");
    }, [question.questionId, fields]);

    const submitForm = (useDefaults = false) => {
        const answers = useDefaults ? Object.fromEntries(fields.map((field) => [field.id, field.defaultValue || ""])) : values;
        const missing = fields.find((field) => (field.required && !String(answers[field.id] || "").trim()) || (field.required && answers[field.id] === "other"));
        if (missing) {
            setValidation(`请填写“${missing.title}”`);
            return;
        }
        setValidation("");
        const displayAnswers: Record<string, string> = {};
        for (const field of fields) {
            const value = String(answers[field.id] || "").trim();
            if (!value || value === "other") continue;
            const option = field.options?.find((item) => (item.id || item.label) === value);
            displayAnswers[field.id] = option?.label || value;
        }
        const fieldTitles = Object.fromEntries(fields.map((field) => [field.id, field.title]));
        onAnswer(
            JSON.stringify({
                type: "form_answer",
                questionId: question.questionId,
                answers,
                displayAnswers,
                fieldTitles,
                skippedFields: fields.filter((field) => !String(answers[field.id] || "").trim()).map((field) => field.id),
                useRecommendedDefaults: useDefaults,
            }),
        );
    };

    const stop = (event: SyntheticEvent) => {
        event.stopPropagation();
    };
    const updateValue = (field: CloudAgentFormField, value: string) => {
        setValues((current) => ({ ...current, [field.id]: value }));
        if (field.allowCustom && value === "other") setCustomFields((current) => ({ ...current, [field.id]: true }));
    };

    if (isForm) {
        return (
            <div className="agent-question-bar agent-question-form mx-3 mb-2 overflow-hidden rounded-xl" style={{ color: theme.node.text }}>
                <div className="flex items-start gap-2 px-3 pt-2.5">
                    <HelpCircle className="mt-[1px] size-3.5 shrink-0" style={{ color: theme.accent.primary }} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[10px] opacity-55">{question.round && question.maxRounds ? `确认 ${question.round}/${question.maxRounds}` : "需求确认"}</div>
                        <div className="text-xs font-semibold leading-5">{question.question}</div>
                        <div className="mt-0.5 text-[10px] opacity-50">已填入推荐值，可按需修改；不重要的字段可以留空。</div>
                    </div>
                </div>
                <div className="agent-question-fields px-3 py-2">
                    {fields.map((field) => {
                        const options = field.options || [];
                        const custom = customFields[field.id] || values[field.id] === "other";
                        return (
                            <div className="agent-question-field" key={field.id}>
                                <label className="agent-question-field-label" htmlFor={`agent-field-${field.id}`}>
                                    {field.title}
                                    {field.required ? <span className="ml-0.5 opacity-70">*</span> : null}
                                </label>
                                <div className="min-w-0 flex-1">
                                    {field.type === "textarea" ? (
                                        <textarea
                                            id={`agent-field-${field.id}`}
                                            rows={2}
                                            value={values[field.id] || ""}
                                            placeholder={field.placeholder}
                                            disabled={disabled}
                                            className="agent-question-input agent-question-textarea"
                                            onChange={(event) => updateValue(field, event.target.value)}
                                            onMouseDown={stop}
                                            onPointerDown={stop}
                                        />
                                    ) : field.type === "text" ? (
                                        <input
                                            id={`agent-field-${field.id}`}
                                            value={values[field.id] || ""}
                                            placeholder={field.placeholder}
                                            disabled={disabled}
                                            className="agent-question-input"
                                            onChange={(event) => updateValue(field, event.target.value)}
                                            onMouseDown={stop}
                                            onPointerDown={stop}
                                        />
                                    ) : (
                                        <div className="agent-question-options" role="radiogroup" aria-label={field.title}>
                                            {options.map((option) => {
                                                const optionId = option.id || option.label;
                                                const selected = values[field.id] === optionId;
                                                return (
                                                    <button
                                                        key={optionId}
                                                        type="button"
                                                        disabled={disabled}
                                                        aria-pressed={selected}
                                                        className={`agent-question-chip${selected ? " is-selected" : ""}`}
                                                        style={selected ? { background: theme.accent.primary, color: theme.accent.onPrimary } : { background: theme.toolbar.itemHover }}
                                                        title={option.detail || option.label}
                                                        onMouseDown={stop}
                                                        onPointerDown={stop}
                                                        onClick={(event) => {
                                                            stop(event);
                                                            updateValue(field, optionId);
                                                        }}
                                                    >
                                                        {option.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {field.allowCustom && (custom || field.type === "text") ? (
                                        <input
                                            value={custom && values[field.id] !== "other" ? values[field.id] || "" : ""}
                                            placeholder={field.placeholder || "输入自定义内容"}
                                            disabled={disabled}
                                            className="agent-question-input mt-1.5"
                                            onChange={(event) => updateValue(field, event.target.value)}
                                            onMouseDown={stop}
                                            onPointerDown={stop}
                                        />
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {validation ? <div className="agent-question-validation px-3 pb-1 text-[10px]">{validation}</div> : null}
                <div className="agent-question-actions px-3 pb-2.5">
                    <button
                        type="button"
                        disabled={disabled}
                        className="agent-question-default"
                        onMouseDown={stop}
                        onPointerDown={stop}
                        onClick={(event) => {
                            stop(event);
                            submitForm(true);
                        }}
                    >
                        按推荐方案开始
                    </button>
                    <button
                        type="button"
                        disabled={disabled}
                        className="agent-question-submit"
                        style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
                        onMouseDown={stop}
                        onPointerDown={stop}
                        onClick={(event) => {
                            stop(event);
                            submitForm();
                        }}
                    >
                        确认并继续
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="agent-question-bar mx-3 mb-2 overflow-hidden rounded-xl" style={{ color: theme.node.text }}>
            <div className="flex items-start gap-2 px-3 pt-2.5">
                <HelpCircle className="mt-[1px] size-3.5 shrink-0" style={{ color: theme.accent.primary }} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] opacity-55">{question.round && question.maxRounds ? `确认 ${question.round}/${question.maxRounds}` : "需要确认"}</div>
                    <div className="text-xs font-semibold leading-5">{question.question}</div>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 px-3 pb-2 pt-2">
                {question.options.map((option) => (
                    <button
                        key={option.label}
                        type="button"
                        disabled={disabled}
                        title={option.detail || option.label}
                        className="agent-question-choice max-w-full rounded-md border-0 px-3 py-1.5 text-left text-xs transition focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: theme.toolbar.itemHover }}
                        onMouseDown={stop}
                        onPointerDown={stop}
                        onClick={(event) => {
                            stop(event);
                            onAnswer(option.label);
                        }}
                    >
                        <span className="block break-words font-medium">{option.label}</span>
                        {option.detail ? <span className="mt-0.5 block break-words text-[10px] leading-4 opacity-60">{option.detail}</span> : null}
                    </button>
                ))}
                <button
                    type="button"
                    disabled={disabled}
                    title="使用安全默认方案继续"
                    className="agent-question-default max-w-full rounded-md border-0 px-3 py-1.5 text-left text-xs font-medium transition focus-visible:outline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onClick={(event) => {
                        stop(event);
                        onAnswer("直接开始");
                    }}
                >
                    按默认方案开始
                </button>
            </div>
            <div className="px-3 pb-2 text-[10px] opacity-50">{question.allowFreeform === false ? "请从上面选一项。" : "也可以在下方输入框里补充说明。"}</div>
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

/**
 * 时间线标记：图标由调用方给（系统行给 Sparkles、错误与审批给 CircleAlert…），不再有默认
 * 的模型品牌 glyph —— 那个圆环标志会被读成"这条是模型/OpenAI 出品"，与它实际表达的
 * "这是谁的一行"无关。
 */
function AgentTimelineMarker({ theme, tone, icon }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; tone: "agent" | "muted" | "approval" | "warning" | "error"; icon: ReactNode }) {
    const color = tone === "error" ? "#ef4444" : tone === "warning" ? "#b45309" : tone === "approval" ? "#f97316" : tone === "agent" ? theme.accent.primary : theme.node.muted;
    return (
        <span className="agent-timeline-marker relative" aria-hidden="true">
            <span className="relative grid size-5 place-items-center rounded-full" style={{ background: tone === "agent" ? theme.accent.primarySoft : theme.node.fill, color }}>
                {icon}
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

function toolCardState(title: string, text: string, detail?: unknown) {
    const status = agentToolStatus(title, text, detail);
    // 失败时优先显示稳定归类（"参数不符合契约"/"画布状态已变化"/"模型输出问题"…）：
    // 它比统一的"执行失败"更能说明下一步该做什么。
    const errorClassLabel = agentToolErrorClassLabel(detail);
    if (status === "completed") return { label: "已完成", color: "#16a34a", softBg: "rgba(22,163,74,.04)", icon: <CheckCircle2 className="size-4" />, isError: false };
    if (status === "failed") return { label: errorClassLabel ?? "执行失败", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (status === "noop") return { label: "未生效", color: "#d97706", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (status === "rejected") return { label: errorClassLabel ?? "拒绝执行", color: "#dc2626", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    return { label: "处理中", color: "#64748b", softBg: "rgba(100,116,139,.04)", icon: <CircleDot className="size-4" />, isError: false };
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
