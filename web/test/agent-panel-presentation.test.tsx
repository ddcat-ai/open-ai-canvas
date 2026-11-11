import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWelcome } from "@/components/canvas/canvas-agent-welcome";
import { AgentConversation } from "@/components/canvas/canvas-cloud-agent-panel-parts";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { agentPermissionVisual } from "@/components/canvas/canvas-cloud-agent-settings";
import { canvasThemes } from "@/lib/canvas-theme";
import { DEFAULT_CANVAS_APPEARANCE, agentCopy } from "@/lib/canvas/agent-appearance";

const noop = () => {};

const conversationProps = { theme: canvasThemes.light, references: [], approval: null, approvalSubmitting: false, onApprovalReasonChange: noop, onApprove: noop, onReject: noop };

test("empty Agent conversation restores the original welcome and three actions", () => {
    const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy={false} nodeCount={0} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("agent-welcome-orb");
    expect(html).toContain("让灵感，慢慢成形");
    expect(html.match(/type="button"/g)).toHaveLength(3);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain("agent-conversation-starter");
    expect(html).not.toContain("agent-scene-capsules");
});

test("original welcome uses configured names and escapes them as text", () => {
    const html = renderToStaticMarkup(<AgentWelcome appearance={{ ...DEFAULT_CANVAS_APPEARANCE, agentName: "我的<工作室>" }} nodeCount={2} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("在这里，和我的&lt;工作室&gt;让灵感，慢慢成形");
    expect(html).toContain("2 个节点");
    expect(html).not.toContain('disabled=""');
});

test("submission state is explicit instead of claiming the model is thinking", () => {
    const html = renderToStaticMarkup(<AgentConversation {...conversationProps} messages={[]} busy activity="submitting" />);
    expect(html).toContain("正在发送…");
    expect(html).not.toContain("正在思考");
    expect(html).not.toContain("实时处理中");
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
    expect(icons[2]).toContain("lucide-circle-play");
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
        expect(button).toContain("h-7");
        expect(button?.includes('disabled=""')).toBe(disabled);
        expect(button).not.toContain("box-shadow:");
    }
});
