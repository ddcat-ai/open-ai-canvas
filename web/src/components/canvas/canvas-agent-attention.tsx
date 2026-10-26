import type { CSSProperties, ReactNode } from "react";
import { BellOff, BellRing, LockKeyhole } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AgentNotificationPermissionState } from "@/services/agent-browser-notifications";
import type { AgentMediaSettings } from "@/services/api/agent";
import type { CanvasNodeData } from "@/types/canvas";
import { AgentQuestionBar, type CloudAgentUserQuestion } from "./canvas-cloud-agent-chat-ui";
import type { ApprovalState } from "./canvas-cloud-agent-events";
import { ApprovalCard } from "./canvas-cloud-agent-panel-parts";

type PermissionGuideCopy = {
    title: string;
    description: string;
    icon: typeof BellRing;
};

function permissionGuideCopy(permission: Exclude<AgentNotificationPermissionState, "granted">): PermissionGuideCopy {
    if (permission === "denied") {
        return {
            title: "浏览器通知已被阻止",
            description: "请从地址栏旁的网站设置中，将“通知”改为允许。收起态处理卡仍然可用。",
            icon: BellOff,
        };
    }
    if (permission === "insecure") {
        return {
            title: "当前页面无法开启浏览器通知",
            description: "浏览器只允许 HTTPS 或 localhost 页面发送通知；收起态处理卡仍然可用。",
            icon: LockKeyhole,
        };
    }
    if (permission === "unsupported") {
        return {
            title: "当前浏览器不支持系统通知",
            description: "你仍可在 Agent 收起时，通过入口上方的处理卡完成审批和回答。",
            icon: BellOff,
        };
    }
    return {
        title: "开启 Agent 浏览器通知",
        description: "仅在页面隐藏或 Agent 收起时提醒审批和提问，不会显示任务内容。",
        icon: BellRing,
    };
}

export function AgentNotificationPermissionGuide({ permission, requesting, onRequest }: { permission: AgentNotificationPermissionState; requesting: boolean; onRequest: () => void }) {
    if (permission === "granted") return null;
    const copy = permissionGuideCopy(permission);
    const Icon = copy.icon;
    return (
        <aside className="canvas-agent-notification-guide" aria-label="Agent 浏览器通知设置">
            <span className="canvas-agent-notification-guide-icon" aria-hidden="true">
                <Icon className="size-4" />
            </span>
            <div className="canvas-agent-notification-guide-copy">
                <strong>{copy.title}</strong>
                <p>{copy.description}</p>
            </div>
            {permission === "default" ? (
                <button type="button" className="canvas-agent-notification-guide-action" disabled={requesting} onClick={onRequest}>
                    {requesting ? "正在请求…" : "允许通知"}
                </button>
            ) : null}
        </aside>
    );
}

export function AgentCollapsedAttentionCard({
    theme,
    approval,
    question,
    guide,
    approvalSubmitting,
    approvalTargetGenerating,
    questionDisabled = false,
    onFocusNode,
    onApprovalReasonChange,
    onApprove,
    onReject,
    onAnswer,
}: {
    theme: CanvasTheme;
    approval?: ApprovalState | null;
    question?: CloudAgentUserQuestion | null;
    guide?: ReactNode;
    approvalSubmitting: boolean;
    approvalTargetGenerating?: CanvasNodeData;
    questionDisabled?: boolean;
    onFocusNode?: (nodeId: string) => void;
    onApprovalReasonChange: (reason: string) => void;
    onApprove: (settings?: AgentMediaSettings) => void;
    onReject: () => void;
    onAnswer: (answer: string) => void;
}) {
    const kind = approval ? "审批" : question ? "回答" : "处理";
    return (
        <div
            className="canvas-agent-attention-card"
            role="dialog"
            aria-label={`Agent 等待${kind}`}
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            style={
                {
                    "--agent-surface-base": theme.node.panel,
                    "--agent-ink": theme.node.text,
                    "--agent-accent": theme.accent.primary,
                    "--agent-shadow-color": theme.spatial.shadow,
                    "--background": theme.node.panel,
                    "--foreground": theme.node.text,
                } as CSSProperties & Record<`--${string}`, string>
            }
            onWheel={(event) => event.stopPropagation()}
        >
            {guide}
            {approval ? (
                <ApprovalCard
                    approval={approval}
                    theme={theme}
                    submitting={approvalSubmitting}
                    summaryOnly
                    targetGenerating={approvalTargetGenerating}
                    onFocusNode={onFocusNode}
                    onReasonChange={onApprovalReasonChange}
                    onApprove={onApprove}
                    onReject={onReject}
                />
            ) : question ? (
                <AgentQuestionBar question={question} theme={theme} compact disabled={questionDisabled} onAnswer={onAnswer} />
            ) : null}
        </div>
    );
}
