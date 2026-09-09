import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Button, Dropdown, Input, Tooltip } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, Check, CheckCircle2, CircleAlert, ChevronDown, Hand, MousePointer2, Paperclip, Puzzle, RotateCw, LoaderCircle, Plus, RotateCcw, Sparkles, UserRound, Wrench, X, XCircle } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasAgentOperationImpact } from "@/lib/canvas/canvas-agent-ops";
import type { LocalUser } from "@/stores/use-user-store";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { Skill } from "@/services/api/skills";
import { agentSlashQuery, insertAgentSkill } from "@/lib/canvas/canvas-agent-input";
import { composeCanvasAgentAnswers, parseCanvasAgentReply } from "@/lib/canvas/canvas-agent-reply";
export { extractCanvasAgentQuickActions, type CanvasAgentQuickAction } from "@/lib/canvas/canvas-agent-reply";
import { cancelCanvasAgentPlan, pauseCanvasAgentPlan, resumeCanvasAgentPlan, type CanvasAgentPlan, type CanvasAgentPlanStatus } from "@/lib/canvas/canvas-agent-plan";

export type CanvasAgentChatAttachment = { id: string; name: string; url: string };
export type CanvasAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: CanvasAgentChatAttachment[];
};

const WORKING_TEXT = "正在推演...";

export function AgentExecutionRegion({ items, theme, children }: { items: CanvasAgentChatMessage[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode }) {
    const plans = items.map((item) => planFromDetail(item.detail)).filter((plan): plan is CanvasAgentPlan => Boolean(plan));
    const tasks = plans.flatMap((plan) => plan.tasks);
    const running = plans.some((plan) => plan.status === "running");
    const failed = tasks.filter((task) => task.status === "failed").length;
    const completed = tasks.filter((task) => task.status === "succeeded").length;
    const stopped = plans.some((plan) => ["blocked", "cancelled", "failed"].includes(plan.status));
    const [open, setOpen] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!running) { setOpen(false); return; }
        const start = Date.now();
        setElapsed(0);
        const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    const activeItem = items.find((item) => planFromDetail(item.detail)?.status === "running");
    const label = running ? `正在执行：${activeItem?.text || "画布操作"}` : failed ? `${completed} 个完成，${failed} 个失败` : stopped ? `执行已停止 · 已完成 ${completed} 个操作` : tasks.length ? `已完成 ${completed} 个操作` : items.at(-1)?.title || "执行记录";
    return <div className="canvas-agent-execution-region text-xs" style={{ color: theme.node.muted }}>
        <button type="button" className="flex w-full items-center gap-2 py-1 text-left focus-visible:outline focus-visible:outline-2" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {running ? <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" /> : stopped ? <CircleAlert className="size-3.5 shrink-0" /> : <Check className="size-3.5 shrink-0" />}
            <span className="min-w-0 truncate">{label}</span>
            {running ? <span className="shrink-0 tabular-nums">{elapsed} 秒</span> : null}
            <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open ? <div className="mt-2 space-y-2 border-l border-current/15 pl-3">{children}</div> : null}
    </div>;
}

export function AgentChatMessage({ item, theme, user, isStreaming = false, retrying = false, quickActionsDisabled = false, onRejectTool, onApproveTool, onQuickAction, onRetry, onRetryPlan, onCancelPlan, onPausePlan, onResumePlan }: { item: CanvasAgentChatMessage; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; user: LocalUser | null; isStreaming?: boolean; retrying?: boolean; quickActionsDisabled?: boolean; onRejectTool?: (id: string) => void; onApproveTool?: (id: string) => void; onQuickAction?: (prompt: string) => void; onRetry?: () => void; onRetryPlan?: (goal: string) => void; onCancelPlan?: (planId: string) => void; onPausePlan?: (planId: string) => void; onResumePlan?: (goal: string) => void }) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    const replyBlocks = item.role === "assistant" && !isStreaming && onQuickAction ? parseCanvasAgentReply(item.text) : [{ kind: "text" as const, text: item.text }];
    const [selections, setSelections] = useState<Record<number, string>>({});
    const [customValues, setCustomValues] = useState<Record<number, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const submittedRef = useRef(false);
    useEffect(() => { setSelections({}); setCustomValues({}); setSubmitted(false); submittedRef.current = false; }, [item.id, item.text]);
    const groupCount = replyBlocks.filter((block) => block.kind === "choices").length;
    const collectAnswers = groupCount > 1 || replyBlocks.some((block) => block.kind === "choices" && block.actions.some((action) => /自定义/u.test(action.label)));
    const completedGroups = Object.entries(selections).filter(([index, label]) => !/自定义/u.test(label) || Boolean(customValues[Number(index)]?.trim())).length;
    const answer = collectAnswers ? composeCanvasAgentAnswers(replyBlocks, selections, customValues) : null;
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
                <AgentToolCard title={item.title || "工具调用"} text={item.text} detail={item.detail} theme={theme} onRetryPlan={onRetryPlan} onCancelPlan={onCancelPlan} onPausePlan={onPausePlan} onResumePlan={onResumePlan} />
            </div>
        );
    }
    return (
        <div className={`canvas-agent-message flex items-start gap-2.5 ${isUser ? "canvas-agent-message-user justify-end" : "canvas-agent-message-assistant justify-start"}`}>
            {!isUser ? <AgentAvatar theme={theme} /> : null}
            <div className={`min-w-0 max-w-[86%] text-sm leading-6 ${isUser ? "rounded-md px-3 py-2.5 text-right" : "text-left"}`} style={{ color, ...(isUser ? { background: theme.accent.primarySoft } : {}) }}>
                {item.role !== "assistant" ? <div className="whitespace-pre-wrap break-words text-left">{item.text}</div> : replyBlocks.map((block, index) => block.kind === "text" ? (
                    <AIMessageMarkdown key={index} className="text-left" isStreaming={isStreaming}>{block.text}</AIMessageMarkdown>
                ) : (
                    <div key={index} className="my-3 flex flex-wrap gap-1.5" role="group" aria-label="快捷选项">
                        {block.actions.map((action) => (
                            <motion.button key={action.label} type="button"
                                aria-pressed={collectAnswers ? selections[index] === action.label : undefined}
                                disabled={quickActionsDisabled || submitted}
                                className="rounded-full px-3 py-1.5 text-left text-xs font-medium outline-none transition-[background-color,transform,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-current/30 hover:-translate-y-px"
                                style={{ background: collectAnswers && selections[index] === action.label ? theme.accent.primarySoft : theme.spatial.surface, color: theme.node.text, boxShadow: `0 4px 14px ${theme.spatial.shadow}` }}
                                whileTap={{ scale: 0.97 }} onClick={() => {
                                    if (quickActionsDisabled || submittedRef.current) return;
                                    if (collectAnswers) setSelections((previous) => ({ ...previous, [index]: action.label }));
                                    else onQuickAction?.(action.prompt);
                                }}>
                                {collectAnswers && selections[index] === action.label ? <Check className="mr-1 inline size-3" aria-hidden="true" /> : null}
                                {action.label}
                            </motion.button>
                        ))}
                        {(() => { const selected = selections[index]; return selected && /自定义/u.test(selected) ? <Input size="small" className="mt-2 w-full" placeholder="请输入自定义内容" value={customValues[index] || ""} onChange={(event) => setCustomValues((previous) => ({ ...previous, [index]: event.target.value }))} aria-label={`${selected}内容`} disabled={quickActionsDisabled || submitted} /> : null; })()}
                    </div>
                ))}
                {collectAnswers ? <div className="my-3 flex items-center gap-3">
                    <Button size="small" type="primary" disabled={!answer || quickActionsDisabled || submitted} onClick={() => {
                        if (!answer || quickActionsDisabled || submittedRef.current || !onQuickAction) return;
                        submittedRef.current = true;
                        setSubmitted(true);
                        onQuickAction(answer);
                    }}>{submitted ? "已提交" : "确认并继续"}</Button>
                    <span className="text-xs" role="status" style={{ color: theme.node.muted }}>{submitted ? "已发送全部选择" : `已完成 ${completedGroups}/${groupCount} 项`}</span>
                </div> : null}
                {item.role === "error" && onRetry ? (
                    <Button size="small" className="mt-2 !h-7" icon={retrying ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} disabled={retrying} onClick={onRetry}>
                        {retrying ? "重试中" : "重试本轮"}
                    </Button>
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
    const isPlan = Boolean(impact && impact.operationCount > 1);
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
                            <span>{isPlan ? "执行计划 · 确认工具调用" : "确认工具调用"}</span>
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
                        {impact.items.length ? <div className="mt-3 space-y-1.5" aria-label={isPlan ? "执行计划步骤" : "操作影响"}>{impact.items.map((item, index) => <div key={`${item}-${index}`} className="flex gap-2 text-xs leading-5" style={{ color: theme.node.muted }}><span className="mt-2 size-1 shrink-0 rounded-full bg-current" /><span>{isPlan ? `${index + 1}. ${item}` : item}</span></div>)}</div> : null}
                        {impact.warning ? <div className="mt-3 rounded-md bg-amber-500/[.08] px-2.5 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">{impact.warning}</div> : null}
                    </div>
                ) : null}
                {planFromDetail(detail) ? <AgentPlanSummary plan={planFromDetail(detail)!} theme={theme} /> : null}
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

export function AgentToolCard({ title, text, detail, theme, onRetryPlan, onCancelPlan, onPausePlan, onResumePlan }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onRetryPlan?: (goal: string) => void; onCancelPlan?: (planId: string) => void; onPausePlan?: (planId: string) => void; onResumePlan?: (goal: string) => void }) {
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
            {planFromDetail(detail) ? <AgentPlanSummary plan={planFromDetail(detail)!} theme={theme} /> : null}
            {(() => { const plan = planFromDetail(detail); return plan?.status === "blocked" && plan.stopReason === "failed" && onRetryPlan ? <Button size="small" className="mt-3" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetryPlan(plan.goal)}>重新规划并重试</Button> : null; })()}
            {(() => { const plan = planFromDetail(detail); return plan && (plan.status === "running" || plan.status === "waiting_approval") && onCancelPlan ? <Button danger size="small" className="mt-3" icon={<XCircle className="size-3.5" />} onClick={() => onCancelPlan(plan.id)}>取消计划</Button> : null; })()}
            {(() => { const plan = planFromDetail(detail); return plan?.status === "running" && onPausePlan ? <Button size="small" className="mt-3 ml-2" icon={<CircleAlert className="size-3.5" />} onClick={() => onPausePlan(plan.id)}>暂停计划</Button> : null; })()}
            {(() => { const plan = planFromDetail(detail); return plan?.status === "blocked" && plan.stopReason !== "failed" && onResumePlan ? <Button size="small" className="mt-3" icon={<RotateCcw className="size-3.5" />} onClick={() => onResumePlan(plan.goal)}>{plan.stopReason === "paused" ? "恢复执行" : "重新读取并继续"}</Button> : null; })()}
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
    right,
    references = [],
    slashSkills,
    includeAssetLibrary,
    confirmTools,
    onConfirmToolsChange,
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
    right?: ReactNode;
    /** 供「@」插入的画布节点/素材/技能引用候选（可选，默认空，缺省时退化为普通输入框） */
    references?: CanvasResourceReference[];
    /** 供「/」弹出的技能候选（可选） */
    slashSkills?: Skill[];
    /** 是否在「@」候选里包含素材库资源 */
    includeAssetLibrary?: boolean;
    /** Agent 工具执行确认模式：询问或自动 */
    confirmTools?: boolean;
    onConfirmToolsChange?: (confirmTools: boolean) => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mentionInputRef = useRef<HTMLTextAreaElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState(60);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const availableSlashSkills = slashSkills ?? [];
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const reducedMotion = useReducedMotion();
    const visibleSlashSkills = slash ? availableSlashSkills.filter((skill) => `${skill.skill_name} ${skill.description || ""}`.toLowerCase().includes(slash.query.toLowerCase())) : availableSlashSkills;
    const activeSlashIndex = Math.min(Math.max(slashIndex, 0), Math.max(visibleSlashSkills.length - 1, 0));
    const focusInput = () => requestAnimationFrame(() => mentionInputRef.current?.focus());

    useEffect(() => {
        if (!slash) return;
        const onOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !composerRef.current?.contains(event.target)) setSlash(null);
        };
        document.addEventListener("pointerdown", onOutside, true);
        return () => document.removeEventListener("pointerdown", onOutside, true);
    }, [slash]);

    useEffect(() => {
        composerRef.current?.querySelector('[data-agent-slash-menu] [aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }, [activeSlashIndex]);

    // 在输入值末尾检测「/关键词」打开技能候选；选择后显示可读的 /技能名，运行时仍按技能名解析。
    const handlePromptChange = (value: string) => {
        onPromptChange(value);
        const next = agentSlashQuery(value);
        if (next) {
            setSlash((current) => (current && current.start === next.start && current.query === next.query ? current : next));
            setSlashIndex(0);
        } else if (slash) {
            setSlash(null);
        }
    };

    const applySlashSkill = (skill: Skill) => {
        const next = insertAgentSkill(prompt, slash, skill.skill_id, skill.skill_name);
        setSlash(null);
        setSlashIndex(0);
        onPromptChange(next);
        focusInput();
    };

    // slash 菜单的键盘控制在 capture 阶段拦截（contentEditable/textarea 内部先消费 Enter，外层冒泡拿不到）
    const handleSlashKeyCapture = (event: ReactKeyboardEvent) => {
        if (!slash) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSlash(null);
        } else if (event.key === "ArrowDown" && visibleSlashSkills.length) {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.min(index + 1, visibleSlashSkills.length - 1));
        } else if (event.key === "ArrowUp" && visibleSlashSkills.length) {
            event.preventDefault();
            event.stopPropagation();
            setSlashIndex((index) => Math.max(index - 1, 0));
        } else if (visibleSlashSkills.length && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            event.stopPropagation();
            applySlashSkill(visibleSlashSkills[activeSlashIndex]);
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

    const insertPromptToken = (token: "@" | "/") => {
        const next = `${prompt}${prompt && !prompt.endsWith(" ") ? " " : ""}${token}`;
        handlePromptChange(next);
        focusInput();
    };

    const addContentMenuItems = [
        { key: "reference", icon: <MousePointer2 className="size-4" />, label: "从画布添加" },
        ...(onAddFiles ? [{ key: "upload", icon: <Paperclip className="size-4" />, label: "上传附件", title: "上传图片附件" }] : []),
        { type: "divider" as const },
        { key: "skill", icon: <Puzzle className="size-4" />, label: "技能" },
    ];

    return (
        <div ref={composerRef} className="canvas-agent-composer" onWheelCapture={(event) => event.stopPropagation()}>
            <div
                className="canvas-agent-composer-surface"
                style={{
                    color: theme.node.text,
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
                    <div className="canvas-agent-composer-input thin-scrollbar" style={{ height: Math.min(200, Math.max(60, contentHeight)) }}>
                        <CanvasResourceMentionTextarea
                            ref={mentionInputRef}
                            value={prompt}
                            references={references}
                            includeAssetLibrary={includeAssetLibrary}
                            sendOnEnter
                            disabled={disabled || sending}
                            onContentSizeChange={setContentHeight}
                            onChange={handlePromptChange}
                            onSubmit={() => { if (canSubmit) onSubmit(); }}
                            className="w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                            containerClassName="h-full"
                            style={{ color: theme.node.text }}
                            placeholder={placeholder}
                            aria-label="Agent 输入"
                        />
                    </div>
                    {slash ? (
                        <div
                            data-agent-slash-menu
                            role="listbox"
                            aria-label="选择技能"
                            className="canvas-agent-slash-menu absolute bottom-full left-0 z-[var(--z-toolbar)] mb-2 w-full max-w-xs rounded-2xl p-1.5 shadow-2xl"
                            style={{ background: theme.toolbar.panel, boxShadow: `0 18px 44px ${theme.spatial.shadow}` }}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {visibleSlashSkills.length ? visibleSlashSkills.map((skill, index) => (
                                <button
                                    key={skill.skill_id}
                                    type="button"
                                    role="option"
                                    aria-selected={index === activeSlashIndex}
                                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                                    style={{ background: index === activeSlashIndex ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                    onMouseEnter={() => setSlashIndex(index)}
                                    onClick={() => applySlashSkill(skill)}
                                >
                                    <Sparkles className="size-3.5 shrink-0 opacity-70" />
                                    <span className="min-w-0 truncate font-medium">{skill.skill_name}</span>
                                    {skill.description ? <span className="min-w-0 flex-1 truncate opacity-50">{skill.description}</span> : null}
                                </button>
                            )) : (
                                <div className="flex items-center gap-2 px-2.5 py-2 text-xs" style={{ color: theme.node.muted }}>
                                    <Sparkles className="size-3.5 shrink-0 opacity-70" />
                                    <span>{availableSlashSkills.length ? "未找到匹配的技能" : "暂无已加入技能，请先在技能库安装"}</span>
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>
                <div className="canvas-agent-composer-toolbar mt-2 flex items-center justify-between gap-2">
                    <div className="canvas-agent-composer-leading flex min-w-0 items-center gap-1.5">
                        {(
                            <>
                                <input ref={fileInputRef} hidden type="file" accept="image/*" multiple onChange={(event) => {
                                    void onAddFiles?.(event.target.files);
                                    event.target.value = "";
                                }} />
                                <Dropdown
                                    trigger={["click"]}
                                    placement="topLeft"
                                    open={addMenuOpen}
                                    onOpenChange={setAddMenuOpen}
                                    classNames={{ root: "canvas-agent-add-menu" }}
                                    menu={{
                                        items: addContentMenuItems,
                                        onClick: ({ key }) => {
                                            setAddMenuOpen(false);
                                            if (key === "upload") fileInputRef.current?.click();
                                            if (key === "reference") insertPromptToken("@");
                                            if (key === "skill") insertPromptToken("/");
                                        },
                                    }}
                                >
                                    <Tooltip arrow={false} title={addMenuOpen ? null : "添加内容"} classNames={{ root: "canvas-agent-tooltip" }}>
                                        <Button type="text" shape="circle" className="canvas-agent-add-content" disabled={disabled || sending} style={{ color: theme.node.muted }} icon={<Plus className="size-4" />} aria-label="添加内容" aria-haspopup="menu" aria-expanded={addMenuOpen} />
                                    </Tooltip>
                                </Dropdown>
                            </>
                        )}
                        {typeof confirmTools === "boolean" && onConfirmToolsChange ? (
                            <AgentConfirmModePicker confirmTools={confirmTools} onChange={onConfirmToolsChange} theme={theme} onSelected={focusInput} />
                        ) : null}
                        {left}
                    </div>
                    <div className="canvas-agent-composer-trailing flex shrink-0 items-center gap-1">
                        {right}
                    <motion.button
                        type="button"
                        disabled={!canSubmit}
                        aria-label={sending ? "发送中" : "发送"}
                        onClick={() => void onSubmit()}
                        whileTap={canSubmit && !reducedMotion ? { scale: 0.96 } : undefined}
                        animate={{ scale: 1 }}
                        transition={sending && !reducedMotion ? { duration: 0.42, ease: "easeOut" } : { type: "spring", stiffness: 420, damping: 24 }}
                        className="canvas-agent-send grid size-8 shrink-0 place-items-center rounded-full p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-current/35 disabled:cursor-not-allowed"
                        style={{
                            background: theme.accent.primary,
                            color: theme.accent.onPrimary,
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
        </div>
    );
}

function AgentPlanSummary({ plan, theme }: { plan: CanvasAgentPlan; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return <div className="mt-3 rounded-lg px-2.5 py-2" aria-label="执行计划任务" style={{ background: theme.node.fill }}>
        <div className="flex items-center justify-between gap-2 text-xs font-medium"><span className="truncate">{plan.goal}</span><span className="shrink-0" style={{ color: planStatusColor(plan.status, theme) }}>{planStatusLabel(plan.status, plan.stopReason)}</span></div>
        <div className="mt-2 space-y-1.5">{plan.tasks.map((task, index) => <div key={task.id} className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}><span className="grid size-4 shrink-0 place-items-center rounded-full text-[10px]" style={{ background: theme.spatial.surface, color: planStatusColor(task.status, theme) }}>{index + 1}</span><span className="min-w-0 flex-1 truncate">{task.type}</span><span className="shrink-0">{task.resultUnknown ? "结果待核对" : planStatusLabel(task.status)}</span></div>)}</div>
    </div>;
}

function planFromDetail(detail: unknown): CanvasAgentPlan | null {
    const plan = objectField(detail, "plan");
    if (!plan || typeof plan !== "object" || !Array.isArray((plan as CanvasAgentPlan).tasks)) return null;
    return plan as CanvasAgentPlan;
}

function planStatusLabel(status: CanvasAgentPlanStatus, stopReason?: CanvasAgentPlan["stopReason"]) {
    if (status === "blocked") {
        if (stopReason === "recovered") return "刷新后待处理";
        if (stopReason === "failed") return "失败后阻塞";
        return "已暂停";
    }
    return { pending: "待执行", running: "执行中", waiting_approval: "待确认", succeeded: "已完成", failed: "失败", cancelled: "已取消" }[status];
}

function planStatusColor(status: CanvasAgentPlanStatus, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    if (status === "succeeded") return "#16a34a";
    if (status === "failed" || status === "blocked") return "#dc2626";
    if (status === "cancelled") return theme.node.muted;
    if (status === "waiting_approval") return "#d97706";
    return theme.accent.primary;
}

function AgentConfirmModePicker({ confirmTools, onChange, theme, onSelected }: { confirmTools: boolean; onChange: (confirmTools: boolean) => void; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelected: () => void }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (open) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }, [open]);
    const current = confirmTools ? {
        label: "询问模式",
        description: "Agent 在执行生成前会寻求你的确认",
        icon: <Hand className="size-3.5" aria-hidden="true" />,
    } : {
        label: "自动模式",
        description: "Agent 会自主规划并自动执行",
        icon: <RotateCw className="size-4" aria-hidden="true" />,
    };

    const selectMode = (next: boolean) => {
        onChange(next);
        setOpen(false);
        onSelected();
    };

    return (
        <Dropdown
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            placement="topLeft"
            classNames={{ root: "canvas-agent-confirm-dropdown" }}
            popupRender={() => (
                <div ref={menuRef} className="canvas-agent-confirm-menu" role="menu" aria-label="Agent 执行模式" style={{ color: theme.node.text }} onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
                    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                        event.preventDefault(); event.stopPropagation();
                        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
                        const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
                        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
                        options[nextIndex]?.focus();
                    } else if (event.key === "Tab") setOpen(false);
                }}>
                    <button type="button" role="menuitemradio" aria-checked={confirmTools} className={`canvas-agent-confirm-option${confirmTools ? " is-selected" : ""}`} onClick={() => selectMode(true)}>
                        <span className="canvas-agent-confirm-option-icon">{currentModeIcon(true)}</span>
                        <span className="canvas-agent-confirm-option-copy">
                            <span className="canvas-agent-confirm-option-label">询问模式</span>
                            <span className="canvas-agent-confirm-option-description">Agent 在执行生成前会寻求你的确认</span>
                        </span>
                        {confirmTools ? <Check className="canvas-agent-confirm-option-check size-4" aria-hidden="true" /> : null}
                    </button>
                    <button type="button" role="menuitemradio" aria-checked={!confirmTools} className={`canvas-agent-confirm-option${!confirmTools ? " is-selected" : ""}`} onClick={() => selectMode(false)}>
                        <span className="canvas-agent-confirm-option-icon">{currentModeIcon(false)}</span>
                        <span className="canvas-agent-confirm-option-copy">
                            <span className="canvas-agent-confirm-option-label">自动模式</span>
                            <span className="canvas-agent-confirm-option-description">Agent 会自主规划并自动执行</span>
                        </span>
                        {!confirmTools ? <Check className="canvas-agent-confirm-option-check size-4" aria-hidden="true" /> : null}
                    </button>
                </div>
            )}
        >
            <button ref={triggerRef} type="button" className="canvas-agent-confirm-mode" aria-haspopup="menu" aria-expanded={open} aria-pressed={confirmTools} aria-label={`当前为${current.label}`} title={`当前为${current.label}`} style={{ color: theme.node.text }}>
                {current.icon}
                <span>{current.label}</span>
                <ChevronDown className="size-3" aria-hidden="true" />
            </button>
        </Dropdown>
    );
}

function currentModeIcon(confirmTools: boolean) {
    return confirmTools ? <Hand className="size-3.5" aria-hidden="true" /> : <RotateCw className="size-4" aria-hidden="true" />;
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
