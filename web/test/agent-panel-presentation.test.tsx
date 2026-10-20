import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWelcome } from "@/components/canvas/canvas-agent-welcome";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { ApprovalCard } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import { applyAgentEvent, type ApprovalState } from "@/components/canvas/canvas-cloud-agent-events";
import { agentPermissionVisual } from "@/components/canvas/canvas-cloud-agent-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { DEFAULT_CANVAS_APPEARANCE, agentCopy } from "@/lib/canvas/agent-appearance";

const noop = () => {};

test("replayed approval snapshots preserve the error only for the same approval", () => {
    let approval: ApprovalState | null = { approvalId: "approval", detail: {}, reason: "", submissionError: "真实审批错误" };
    const setApproval: Parameters<typeof applyAgentEvent>[3] = (action) => {
        approval = typeof action === "function" ? action(approval) : action;
    };
    for (const eventType of ["run_status", "approval_requested"]) {
        applyAgentEvent({ eventId: "event", runId: "run", seq: 1, type: eventType, createdAt: "", payload: { status: "waiting_approval", approvalId: "approval", approval: { approvalId: "approval" } } }, noop, noop, setApproval);
        expect(approval?.submissionError).toBe("真实审批错误");
    }
    applyAgentEvent({ eventId: "next", runId: "run", seq: 2, type: "approval_requested", createdAt: "", payload: { approvalId: "next" } }, noop, noop, setApproval);
    expect(approval?.submissionError).toBeUndefined();
});

test("approval failure stays visible beside the controls in both themes", () => {
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const html = renderToStaticMarkup(
            <ApprovalCard approval={{ approvalId: "approval", reason: "", detail: {}, submissionError: "画布内容已变化，未提交任务" }} theme={theme} submitting={false} onReasonChange={noop} onApprove={noop} onReject={noop} />,
        );
        expect(html).toContain('role="alert"');
        expect(html).toContain("审批未通过：画布内容已变化，未提交任务");
        expect(html).toContain("同意执行");
        expect(html).not.toContain("正在提交");
    }
});

test("welcome uses the independent assistant name and escapes it as text", () => {
    const html = renderToStaticMarkup(<AgentWelcome appearance={{ ...DEFAULT_CANVAS_APPEARANCE, agentName: "我的<工作室>" }} nodeCount={2} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("在这里，和我的&lt;工作室&gt;让灵感，慢慢成形");
    expect(html).toContain("2 个节点");
    expect(html.match(/type="button"/g)).toHaveLength(3);
    expect(html).not.toContain('disabled=""');
});

test("empty canvas disables only the canvas-analysis shortcut", () => {
    const html = renderToStaticMarkup(<AgentWelcome appearance={DEFAULT_CANVAS_APPEARANCE} nodeCount={0} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain("添加节点后，一起梳理创作思路");
    expect(html).not.toContain("生成前由你确认");
});

test("assistant template replacement treats names literally", () => {
    expect(agentCopy("{agentName} / {agentName}", "$&小鱼")).toBe("$&小鱼 / $&小鱼");
});

test("permission modes have distinct icons, not just distinct colors", () => {
    const icons = (["read_only", "request_approval", "auto"] as const).map((mode) => {
        const Icon = agentPermissionVisual(mode).icon;
        return renderToStaticMarkup(<Icon />);
    });
    expect(new Set(icons).size).toBe(3);
    expect(icons[0]).toContain("lucide-lock-keyhole");
    expect(icons[1]).toContain("lucide-shield-check");
    expect(icons[2]).toContain("lucide-sparkles");
});

test("compact send button preserves empty-draft and sending guards", () => {
    for (const [prompt, sending, disabled] of [
        ["", false, true],
        ["故事灵感", false, false],
        ["故事灵感", true, true],
    ] as const) {
        const html = renderToStaticMarkup(<AgentChatComposer prompt={prompt} sending={sending} placeholder="聊聊想法" theme={canvasThemes.dark} onPromptChange={noop} onSubmit={noop} />);
        const button = html.match(/<button\b[^>]*class="agent-composer-send [^"]*"[^>]*>/)?.[0];
        expect(button).toBeDefined();
        expect(button).toContain("size-7");
        expect(button?.includes('disabled=""')).toBe(disabled);
        expect(button).not.toContain("box-shadow:");
    }
});
