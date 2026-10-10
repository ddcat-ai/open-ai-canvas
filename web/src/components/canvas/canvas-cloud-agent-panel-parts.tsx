// 画布 Agent 面板的展示组件：悬浮入口、标题栏、上下文用量环、历史会话、对话区、
// 输入区控件与审批卡片。
//
// 这些组件只接收 props、不直接访问 Agent API；状态与副作用集中在 CanvasCloudAgentPanel。

import type { CanvasTheme } from "@/lib/canvas-theme";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { agentCopy, DEFAULT_CANVAS_APPEARANCE } from "@/lib/canvas/agent-appearance";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAgentLauncherPosition } from "./use-agent-launcher-position";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Live2DAvatar } from "./live2d-avatar";
import { live2DModelURL } from "@/services/api/appearance";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { ArrowLeft, Check, CircleDot, Clock3, Download, History, LoaderCircle, MessageSquarePlus, RotateCcw, Settings2, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { Button, Dropdown, Input, Popover } from "antd";
import type { AgentContextPhase, AgentContextUsageView } from "@/lib/canvas/agent-context-usage";
import type { CloudAgentConversation } from "@/services/cloud-agent-conversations";
import { AgentChatMessage, AgentOperationFeed, AgentReasoningFeed, AgentWorkingMessage, type CloudAgentChatMessage } from "./canvas-cloud-agent-chat-ui";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasNodeData } from "@/types/canvas";
import type { AgentMediaSettings, AgentPermissionMode } from "@/services/api/agent";
import { buildAgentFeedSegments } from "@/lib/canvas/agent-operation-feed";
import { AgentWelcome } from "./canvas-agent-welcome";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { agentPermissionLabel, agentPermissionMenuItems, agentPermissionVisual } from "./canvas-cloud-agent-settings";
import { ModelPicker } from "@/components/model-picker";
import { agentImageApproval } from "@/lib/canvas/agent-media-approval";
import { agentApprovalPresentation } from "@/lib/canvas/agent-approval-presentation";
import { CanvasAgentImageApprovalSettings } from "./canvas-agent-image-approval-settings";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import type { ApprovalState } from "./canvas-cloud-agent-events";

// hidden 为 true 时入口保持挂载但不显示：Live2D 模型加载开销大，面板开合不能卸载它，
// 否则每次重新挂载都要重新下载模型并重建渲染上下文，期间只能显示默认形象。
export function AgentLauncher({ theme, statusColor, approvalPending, reducedMotion, hidden = false, onOpen }: { theme: CanvasTheme; statusColor: string; approvalPending: boolean; reducedMotion: boolean; hidden?: boolean; onOpen: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const live = appearance.avatarType === "live2d" && Boolean(appearance.live2dResourceId && appearance.live2dEntry);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    useEffect(() => {
        const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    const height = live ? Math.max(40, Math.min(appearance.avatarHeight, viewport.height - 60, (viewport.width - 40) / 0.75)) : 76;
    const width = live ? Math.round(height * 0.75) : 76;
    const { position, dragging, handlers } = useAgentLauncherPosition(onOpen, width, height);
    return (
        <motion.button
            type="button"
            aria-label={`打开${appearance.agentName}`}
            title={`${approvalPending ? "Agent 等待你的审批" : "打开 Agent 助手"} · 拖动可调整位置，聚焦后可用方向键移动`}
            className={cn("canvas-agent-launcher fixed z-[calc(var(--z-toast)+1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/35", dragging && "is-dragging", live && "canvas-agent-launcher-live2d")}
            style={{ ...position, width, height, color: theme.node.text, "--canvas-agent-launcher-shadow": theme.spatial.shadow, ...(hidden ? { display: "none" } : null) } as CSSProperties}
            aria-hidden={hidden || undefined}
            tabIndex={hidden ? -1 : undefined}
            data-canvas-no-zoom
            {...handlers}
            whileHover={reducedMotion || dragging ? undefined : { scale: 1.035 }}
            whileTap={reducedMotion || dragging ? undefined : { scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
        >
            {live ? (
                <Live2DAvatar url={live2DModelURL(appearance.live2dResourceId, appearance.live2dEntry)} width={width} height={height} reducedMotion={reducedMotion} fallback={<FluidOrb size={60} color="#7164f6" />} />
            ) : (
                <FluidOrb size={60} color="#7164f6" />
            )}
            {appearance.launcherLabel ? <span className="canvas-agent-launcher-label">{appearance.launcherLabel}</span> : null}
            <span className={cn("canvas-agent-launcher-status", approvalPending && "is-pending")} style={{ "--canvas-agent-status-color": statusColor } as CSSProperties} />
            {approvalPending ? <span className="canvas-agent-launcher-badge">待审批</span> : null}
        </motion.button>
    );
}

export function AgentHeader({
    theme,
    hasMessages,
    statusLabel,
    statusColor,
    nodeCount,
    onNew,
    onHistory,
    onSettings,
    onResetLayout,
    onCollapse,
    onExport,
    exporting,
}: {
    theme: CanvasTheme;
    hasMessages: boolean;
    statusLabel: string;
    statusColor: string;
    nodeCount: number;
    onNew: () => void;
    onHistory: () => void;
    onSettings: () => void;
    onResetLayout: () => void;
    onCollapse: () => void;
    onExport: () => void;
    exporting: boolean;
}) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    return (
        <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="agent-panel-title">
                        {agentCopy(appearance.panelTitle, appearance.agentName)}
                        {hasMessages ? "" : " · 新对话"}
                    </span>
                    <span className="agent-panel-status flex items-center gap-1" style={{ color: statusColor }}>
                        <CircleDot className="size-3" />
                        {statusLabel}
                    </span>
                </div>
                <div className="agent-panel-context">
                    {appearance.agentName} · 当前画布 {nodeCount} 个节点
                </div>
            </div>
            <div className="agent-header-actions flex items-center gap-0.5" style={{ color: theme.node.muted }}>
                <Button type="text" shape="circle" icon={<RotateCcw className="size-4" />} onClick={onResetLayout} aria-label="恢复 Agent 默认窗口" title="恢复默认位置并拉满可用高度" className="hidden sm:inline-flex" />
                <Button type="text" shape="circle" icon={<Download className="size-4" />} loading={exporting} onClick={onExport} aria-label="导出 Agent 调试记录" title="导出对话、工具参数、审批和错误（分享前请检查隐私）" />
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
                <Button type="text" shape="circle" icon={<History className="size-4" />} onClick={onHistory} aria-label="历史对话" title="历史对话" />
                <Button type="text" shape="circle" icon={<Settings2 className="size-4" />} onClick={onSettings} aria-label="Agent 设置" title="Agent 设置" />
                <Button type="text" shape="circle" icon={<X className="size-4" />} onClick={onCollapse} aria-label="收起 Agent" title="收起" />
            </div>
        </header>
    );
}

export const CONTEXT_PHASE_LABEL: Record<AgentContextPhase, string> = {
    idle: "尚未测量",
    unknown: "窗口未知",
    ok: "上下文充足",
    watch: "接近压缩",
    compress: "即将压缩",
    compacting: "正在压缩",
    stale: "压缩后待刷新",
};

export function formatContextCount(tokens: number | undefined) {
    if (tokens === undefined) return "—";
    if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}K`;
    return Math.round(tokens).toLocaleString("zh-CN");
}

export function formatContextBytes(bytes: number | undefined) {
    if (bytes === undefined) return "—";
    if (bytes >= 1_000_000) return `${Math.round(bytes / 100_000) / 10} MB`;
    if (bytes >= 1_000) return `${Math.round(bytes / 100) / 10} KB`;
    return `${Math.round(bytes).toLocaleString("zh-CN")} 字节`;
}

export function AgentContextRing({ view }: { view: AgentContextUsageView }) {
    const [open, setOpen] = useState(false);
    const marker = view.compactRatio && view.compactRatio > 0 && view.compactRatio < 1 ? view.compactRatio : undefined;
    const percent = view.ratio === undefined ? view.label : `${Math.round(view.ratio * 100)}%`;
    const meterLabel = view.ratio === undefined ? "—" : percent;
    const used = formatContextCount(view.inputTokens);
    const budget = formatContextCount(view.usableTokens);
    const remaining = formatContextCount(view.remainingTokens);
    const protocolBytes = formatContextBytes(view.protocolBytes);
    const usedRatio = view.ratio === undefined ? 0 : Math.max(0, Math.min(1, view.ratio));
    const phaseLabel = CONTEXT_PHASE_LABEL[view.phase];
    const sourceLabel = view.tokenSource === "pi" ? "Pi 会话估算" : "未测量";
    const usageHeading = view.ratio !== undefined ? `上下文已用 ${percent}` : view.phase === "idle" ? "上下文用量" : view.phase === "unknown" ? "上下文窗口未知" : `上下文${view.label}`;

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            overlayClassName="agent-context-popover"
            getPopupContainer={(trigger) => trigger.closest<HTMLElement>(".canvas-agent-panel") ?? document.body}
            content={
                <div className="agent-context-panel" data-phase={view.phase}>
                    <span className="agent-context-eyebrow">下一次请求 · 上下文窗口占用</span>
                    <div className="agent-context-panel-head">
                        <strong>{usageHeading}</strong>
                        {view.phase !== "ok" ? <span className={`agent-context-phase is-${view.phase}`}>{phaseLabel}</span> : null}
                    </div>
                    <div className="agent-context-summary">
                        {view.remainingTokens !== undefined && view.usableTokens !== undefined ? (
                            <>
                                <strong>{used}</strong>
                                <span>/ {budget} Token</span>
                                <em>剩余 {remaining}</em>
                            </>
                        ) : (
                            <>
                                <strong>{used}</strong>
                                <span>Token</span>
                            </>
                        )}
                    </div>
                    <div className="agent-context-progress-head">
                        <span>上下文窗口占用</span>
                        <strong>{percent}</strong>
                    </div>
                    <div className="agent-context-progress" role="progressbar" aria-label={`上下文已用 ${percent}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.ratio === undefined ? undefined : Math.round(view.ratio * 100)}>
                        <span style={{ width: `${usedRatio * 100}%` }} />
                        {marker ? <i style={{ left: `${marker * 100}%` }} aria-hidden="true" /> : null}
                    </div>
                    <p className="agent-context-detail">{view.detail}</p>
                    {view.breakdown.length || view.protocolBytes !== undefined || view.remainingTokens !== undefined ? (
                        <ul className="agent-context-breakdown">
                            {view.breakdown.map((item) => (
                                <li key={item.key}>
                                    <span className="agent-context-breakdown-dot" aria-hidden="true" />
                                    <span className="agent-context-breakdown-label">{item.label}</span>
                                    <span className="agent-context-breakdown-value">{formatContextCount(item.tokens)}</span>
                                </li>
                            ))}
                            {view.protocolBytes !== undefined ? (
                                <li className="is-secondary">
                                    <span className="agent-context-breakdown-dot" aria-hidden="true" />
                                    <span className="agent-context-breakdown-label">协议外壳</span>
                                    <span className="agent-context-breakdown-value">{protocolBytes}</span>
                                </li>
                            ) : null}
                            {view.remainingTokens !== undefined ? (
                                <li className="is-muted">
                                    <span className="agent-context-breakdown-dot" aria-hidden="true" />
                                    <span className="agent-context-breakdown-label">未使用</span>
                                    <span className="agent-context-breakdown-value">{remaining}</span>
                                </li>
                            ) : null}
                        </ul>
                    ) : null}
                    <div className="agent-context-panel-foot">
                        <span>
                            {sourceLabel}
                            {view.tokenSource === "pi" ? " · 不是计费 Token" : ""}
                        </span>
                        {view.compactAtTokens ? <span>压缩线 {formatContextCount(view.compactAtTokens)}</span> : null}
                    </div>
                    {view.compactionError ? (
                        <p className="agent-context-note" role="status">
                            {view.compactionError}
                        </p>
                    ) : view.lastCompaction ? (
                        <p className="agent-context-note">本轮已完成一次上下文压缩，下一次读数会刷新。</p>
                    ) : null}
                </div>
            }
        >
            <button type="button" className={`agent-context-ring is-${view.phase}`} aria-label={`${usageHeading}，${phaseLabel}。点击查看明细`} aria-expanded={open} title="查看上下文用量" onPointerDown={(event) => event.stopPropagation()}>
                <span
                    className="agent-context-ring-visual"
                    aria-hidden="true"
                    style={
                        {
                            "--agent-context-progress": `${view.ring * 100}%`,
                            "--agent-context-marker-angle": `${(marker || 0) * 360}deg`,
                        } as CSSProperties
                    }
                >
                    {marker ? <span className="agent-context-ring-marker" /> : null}
                </span>
                <span className="agent-context-meter-copy">
                    <strong>{meterLabel}</strong>
                    <small>上下文</small>
                </span>
            </button>
        </Popover>
    );
}

export function AgentHistory({
    conversations,
    activeConversationId,
    theme,
    onBack,
    onNew,
    onOpen,
    onDelete,
}: {
    conversations: CloudAgentConversation[];
    activeConversationId: string;
    theme: CanvasTheme;
    onBack: () => void;
    onNew: () => void;
    onOpen: (conversation: CloudAgentConversation) => void;
    onDelete: (id: string) => void;
}) {
    return (
        <div className="canvas-agent-history-root flex min-h-0 min-w-0 flex-1 flex-col">
            <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-2">
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={onBack} aria-label="返回对话" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">历史对话</div>
                    <div className="mt-0.5 text-[11px] opacity-40">保存在当前账号与画布下</div>
                </div>
                <Button type="text" shape="circle" icon={<MessageSquarePlus className="size-4" />} onClick={onNew} aria-label="新建对话" title="新建对话" />
            </header>
            <div className="canvas-agent-history-scroll thin-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3">
                {conversations.length ? (
                    <div className="space-y-1">
                        {conversations.map((conversation) => {
                            const preview = truncateConversationPreview(conversation.messages.at(-1)?.text || "尚未发送消息");
                            const active = conversation.id === activeConversationId;
                            return (
                                <div
                                    key={conversation.id}
                                    className="canvas-agent-history-item group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors"
                                    style={{ background: active ? theme.toolbar.itemHover : "transparent", color: theme.node.text }}
                                >
                                    <button type="button" className="canvas-agent-history-open flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onOpen(conversation)} aria-current={active ? "page" : undefined}>
                                        <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.node.fill, color: theme.node.muted }}>
                                            <Clock3 className="size-3.5" />
                                        </span>
                                        <span className="canvas-agent-history-text min-w-0 flex-1">
                                            <span className="canvas-agent-history-title block truncate text-[13px] font-medium">{conversation.title}</span>
                                            <span className="canvas-agent-history-preview mt-0.5 block text-[11px] opacity-40" title={preview}>
                                                {preview}
                                            </span>
                                        </span>
                                        <span className="canvas-agent-history-time shrink-0 text-[10px] opacity-35">{formatConversationTime(conversation.updatedAt)}</span>
                                    </button>
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        className="canvas-agent-history-delete !h-7 !px-2 !text-xs !opacity-80"
                                        icon={<Trash2 className="size-3.5" />}
                                        onClick={() => onDelete(conversation.id)}
                                        aria-label={`删除对话 ${conversation.title}`}
                                        title="删除对话"
                                    >
                                        删除
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                        <History className="size-5 opacity-30" />
                        <div className="mt-3 text-sm font-medium">还没有历史对话</div>
                        <div className="mt-1 text-xs opacity-40">发送第一条消息后会自动保存</div>
                    </div>
                )}
            </div>
        </div>
    );
}

export function AgentConversation({
    theme,
    messages,
    references,
    busy,
    approval,
    approvalTargetGenerating,
    approvalSubmitting,
    nodeCount,
    onChooseSkill,
    onDraftPrompt,
    onFocusNode,
    onApprovalReasonChange,
    onApprove,
    onReject,
}: {
    theme: CanvasTheme;
    messages: CloudAgentChatMessage[];
    references: CanvasResourceReference[];
    busy: boolean;
    approval: ApprovalState | null;
    approvalTargetGenerating?: CanvasNodeData;
    approvalSubmitting: boolean;
    nodeCount: number;
    onChooseSkill: () => void;
    onDraftPrompt: (prompt: string) => void;
    onFocusNode?: (nodeId: string) => void;
    onApprovalReasonChange: (reason: string) => void;
    onApprove: (settings?: AgentMediaSettings) => void;
    onReject: () => void;
}) {
    const appearance = useAppearanceStore((state) => state.appearance.canvas) || DEFAULT_CANVAS_APPEARANCE;
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const lastUserId = messages.findLast((item) => item.role === "user")?.id;
    // 连续的工具记录折成一行（只报最新一步），计划/提问载体由输入区上方的固定条渲染。
    const segments = useMemo(() => buildAgentFeedSegments(messages), [messages]);
    const lastMessage = messages.at(-1);

    // 自己发送时恢复跟随；阅读旧消息时不让流式输出抢走滚动位置。
    useLayoutEffect(() => {
        followRef.current = true;
    }, [lastUserId]);
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (element && followRef.current) element.scrollTop = element.scrollHeight;
    }, [messages, busy, approval]);
    useEffect(() => {
        const element = scrollRef.current;
        const content = contentRef.current;
        if (!element || !content) return;
        const observer = new ResizeObserver(() => {
            if (followRef.current) element.scrollTop = element.scrollHeight;
        });
        observer.observe(element);
        observer.observe(content);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={scrollRef}
            data-agent-conversation
            className="agent-conversation thin-scrollbar min-h-0 flex-1 overflow-y-auto"
            onScroll={(event) => {
                const element = event.currentTarget;
                followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
        >
            {!messages.length ? <AgentWelcome appearance={appearance} nodeCount={nodeCount} onChooseSkill={onChooseSkill} onDraftPrompt={onDraftPrompt} /> : null}
            <div ref={contentRef} className="agent-conversation-messages">
                {segments.map((segment, index) =>
                    segment.kind === "operations" ? (
                        // 只有"对话末尾那一段 + 还在跑"才流光：历史段落留在静态态，任务完成即停。
                        <AgentOperationFeed key={segment.key} items={segment.items} theme={theme} references={references} onFocusNode={onFocusNode} live={busy && index === segments.length - 1} />
                    ) : segment.kind === "reasoning" ? (
                        <AgentReasoningFeed key={segment.key} items={segment.items} theme={theme} />
                    ) : (
                        <AgentChatMessage key={segment.key} item={segment.item} theme={theme} references={references} onFocusNode={onFocusNode} isStreaming={busy && !approval && segment.item.streaming === true && segment.item === lastMessage} />
                    ),
                )}
                {approval ? (
                    <ApprovalCard
                        key={approval.approvalId}
                        approval={approval}
                        theme={theme}
                        submitting={approvalSubmitting}
                        targetGenerating={approvalTargetGenerating}
                        onFocusNode={onFocusNode}
                        onReasonChange={onApprovalReasonChange}
                        onApprove={onApprove}
                        onReject={onReject}
                    />
                ) : null}
                {busy && !approval ? <AgentWorkingMessage theme={theme} label="正在处理当前画布" /> : null}
            </div>
        </div>
    );
}

export function ComposerControls({
    config,
    selectedModel,
    permissionMode,
    theme,
    onModelChange,
    onPermissionChange,
    skillsOpen,
    onSkillsOpenChange,
    selectedSkillCount,
}: {
    config: ReturnType<typeof useEffectiveConfig>;
    selectedModel: string;
    permissionMode: AgentPermissionMode;
    theme: CanvasTheme;
    onModelChange: (model: string) => void;
    onPermissionChange: (mode: AgentPermissionMode) => void;
    skillsOpen: boolean;
    onSkillsOpenChange: (open: boolean) => void;
    selectedSkillCount: number;
}) {
    const permissionVisual = agentPermissionVisual(permissionMode);
    const PermissionIcon = permissionVisual.icon;
    return (
        <div className="agent-composer-selection flex min-w-0 flex-1 flex-nowrap items-center gap-0.5">
            <ModelPicker
                config={config}
                value={selectedModel}
                capability="text"
                onChange={onModelChange}
                variant="creation"
                fullWidth
                className="agent-composer-model-trigger !h-8 !min-w-0 !w-full !max-w-full !border-0 !bg-transparent !px-1.5 !shadow-none"
                popoverClassName="agent-model-picker-popover"
                showSelectedPrice={false}
                showOptionPrices
                placeholder="选择文本模型"
            />
            <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: agentPermissionMenuItems(permissionMode, onPermissionChange) }}>
                <button
                    type="button"
                    className="grid size-8 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                    style={{ color: theme.node.muted, background: "transparent" }}
                    aria-label={`执行权限：${agentPermissionLabel(permissionMode)}，点击切换`}
                    title={`执行权限：${agentPermissionLabel(permissionMode)}，点击切换`}
                >
                    <PermissionIcon className="size-3.5" style={{ color: permissionVisual.color }} aria-hidden="true" />
                </button>
            </Dropdown>
            <button
                type="button"
                className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/25"
                style={{ color: selectedSkillCount ? theme.accent.primary : theme.node.muted, background: skillsOpen ? theme.node.fill : "transparent" }}
                aria-label={`打开 Skills 技能库${selectedSkillCount ? `，已启用 ${selectedSkillCount} 个` : ""}`}
                aria-expanded={skillsOpen}
                aria-haspopup="dialog"
                title="打开 Skills 技能库"
                onClick={() => onSkillsOpenChange(true)}
            >
                <Sparkles className="size-3.5" />
                <span className="max-w-28 truncate">Skills({selectedSkillCount})</span>
            </button>
        </div>
    );
}

export function ApprovalCard({
    approval,
    theme,
    submitting,
    targetGenerating,
    onFocusNode,
    onReasonChange,
    onApprove,
    onReject,
}: {
    approval: ApprovalState;
    theme: CanvasTheme;
    submitting: boolean;
    /** 目标节点已在画布上直接生成：禁用“同意执行”，等待后端关闭本次审批。 */
    targetGenerating?: CanvasNodeData;
    onFocusNode?: (nodeId: string) => void;
    onReasonChange: (value: string) => void;
    onApprove: (settings?: AgentMediaSettings) => void;
    onReject: () => void;
}) {
    const [showReason, setShowReason] = useState(Boolean(approval.reason));
    const [mediaSettings, setMediaSettings] = useState<AgentMediaSettings>();
    const imageApproval = agentImageApproval(approval.detail);
    const action = agentApprovalPresentation(approval.detail);
    return (
        <section className="canvas-agent-approval-card" aria-label={action.title}>
            <div className="canvas-agent-approval-header">
                <span className="canvas-agent-approval-icon" aria-hidden="true">
                    <ShieldCheck className="size-4" />
                </span>
                <h3>{action.title}</h3>
                <span className="canvas-agent-approval-badge">{targetGenerating ? "已在节点中生成" : "等待你的确认"}</span>
            </div>
            <p className="canvas-agent-approval-description" style={{ color: theme.node.muted }}>
                {action.description}
            </p>
            {action.items.length ? (
                <div className="canvas-agent-approval-items" aria-label="涉及节点">
                    {action.items.map((item, index) => (
                        <ApprovalPreviewItemView
                            key={`${item.operation}-${item.nodeId || item.nodeTitle || index}-${index}`}
                            item={imageApproval ? { ...item, details: item.details?.filter((detail) => !/^(模型|画幅|质量)[：:]/.test(detail)) } : item}
                            theme={theme}
                            onFocusNode={onFocusNode}
                        />
                    ))}
                </div>
            ) : (
                <div className="canvas-agent-approval-empty" style={{ color: theme.node.muted }}>
                    无法确认具体目标，继续前请重新读取画布。
                </div>
            )}
            {imageApproval ? <CanvasAgentImageApprovalSettings initial={imageApproval} value={mediaSettings} onChange={setMediaSettings} theme={theme} disabled={submitting} /> : null}
            <button type="button" className="canvas-agent-approval-reason-toggle" aria-expanded={showReason} onClick={() => setShowReason((value) => !value)} disabled={submitting}>
                {showReason ? "收起拒绝理由" : "填写拒绝理由（可选）"}
            </button>
            {showReason ? (
                <Input.TextArea
                    className="canvas-agent-approval-reason"
                    value={approval.reason}
                    onChange={(event) => onReasonChange(event.target.value)}
                    placeholder="告诉 Agent 为什么暂不执行"
                    autoSize={{ minRows: 2, maxRows: 3 }}
                    maxLength={2000}
                    disabled={submitting}
                />
            ) : null}
            {targetGenerating ? (
                <p className="canvas-agent-approval-description" role="status" style={{ color: theme.node.muted }}>
                    你已在节点《{targetGenerating.title || "未命名节点"}》上直接提交了生成，Agent 不会重复提交；本次审批会自动关闭。
                </p>
            ) : null}
            <div className="canvas-agent-approval-actions">
                <button type="button" className="canvas-agent-approval-reject" disabled={submitting} onClick={onReject}>
                    暂不执行
                </button>
                <button type="button" className="canvas-agent-approval-approve" disabled={submitting || Boolean(targetGenerating)} onClick={() => onApprove(mediaSettings)}>
                    {submitting ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                    {submitting ? "正在提交" : targetGenerating ? "已在节点中生成" : "同意执行"}
                </button>
            </div>
        </section>
    );
}

export function ApprovalPreviewItemView({ item, theme, onFocusNode }: { item: ReturnType<typeof agentApprovalPresentation>["items"][number]; theme: CanvasTheme; onFocusNode?: (nodeId: string) => void }) {
    const operationLabel =
        item.operation === "add_node"
            ? "新增"
            : item.operation === "update_node"
              ? "修改"
              : item.operation === "connect_nodes"
                ? "连线"
                : item.operation === "arrange_nodes"
                  ? "整理"
                  : item.operation === "create_storyboard"
                    ? "创建分镜"
                    : item.operation === "edit_storyboard"
                      ? "修改分镜"
                      : item.operation === "create_character"
                        ? "创建角色卡"
                        : item.operation === "plan_step"
                          ? "计划"
                          : "生成";
    const renderNode = (title: string | undefined, id: string | undefined, typeLabel: string | undefined, role: "source" | "target" | "node") => {
        if (!title) return null;
        const content = (
            <>
                <span className="canvas-agent-approval-node-title">{title}</span>
                {typeLabel ? <span className="canvas-agent-approval-node-type">{typeLabel}</span> : null}
            </>
        );
        return id && onFocusNode ? (
            <button type="button" className="canvas-agent-approval-node canvas-agent-approval-node-button" onClick={() => onFocusNode(id)} title="定位到画布节点">
                {content}
            </button>
        ) : (
            <span className={`canvas-agent-approval-node canvas-agent-approval-node-${role}`}>{content}</span>
        );
    };
    return (
        <article className={`canvas-agent-approval-item canvas-agent-approval-item-${item.operation}${item.fields?.length ? " canvas-agent-approval-item-has-fields" : ""}`}>
            <div className="canvas-agent-approval-item-main">
                <span className={`canvas-agent-approval-operation canvas-agent-approval-operation-${item.operation}`}>{operationLabel}</span>
                {item.operation === "connect_nodes" ? (
                    <div className="canvas-agent-approval-connection">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "source")}
                        <span className="canvas-agent-approval-arrow" aria-hidden="true">
                            →
                        </span>
                        {renderNode(item.targetNodeTitle, item.targetNodeId, undefined, "target")}
                    </div>
                ) : (
                    <div className="canvas-agent-approval-node-summary">
                        {renderNode(item.nodeTitle, item.nodeId, item.nodeTypeLabel, "node")}
                        {item.resultTitle ? (
                            <>
                                <span className="canvas-agent-approval-change-arrow" aria-hidden="true">
                                    改为
                                </span>
                                <span className="canvas-agent-approval-result-title">《{item.resultTitle}》</span>
                            </>
                        ) : null}
                    </div>
                )}
            </div>
            {item.fields?.length ? (
                <div className="canvas-agent-approval-field-list">
                    {item.operation === "add_node" ? "包含：" : "修改："}
                    {item.fields.map((field) => (
                        <span key={field}>{field}</span>
                    ))}
                </div>
            ) : null}
            {item.details?.length ? (
                <div className="canvas-agent-approval-detail-list">
                    {item.details.map((detail) => (
                        <span key={detail}>{detail}</span>
                    ))}
                </div>
            ) : null}
            <div className="canvas-agent-approval-summary">{item.summary}</div>
        </article>
    );
}

export function truncateConversationPreview(value: string, max = 96) {
    const compact = markdownPlainText(value);
    return compact.length > max ? `${compact.slice(0, max)}…` : compact || "尚未发送消息";
}

export function formatConversationTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
