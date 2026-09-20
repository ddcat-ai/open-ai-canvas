import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentWelcome } from "@/components/canvas/canvas-agent-welcome";
import { AgentChatComposer } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { agentPermissionVisual } from "@/components/canvas/canvas-cloud-agent-settings";
import { canvasThemes } from "@/lib/canvas-theme";

const noop = () => {};

test("welcome uses the configured brand and escapes it as text", () => {
    const html = renderToStaticMarkup(<AgentWelcome brandName="我的<工作室>" nodeCount={2} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html).toContain("在这里，和我的&lt;工作室&gt;让灵感，慢慢成形");
    expect(html).toContain("2 个节点");
    expect(html.match(/type="button"/g)).toHaveLength(3);
    expect(html).not.toContain('disabled=""');
});

test("empty canvas disables only the canvas-analysis shortcut", () => {
    const html = renderToStaticMarkup(<AgentWelcome brandName="影策" nodeCount={0} onChooseSkill={noop} onDraftPrompt={noop} />);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain("添加节点后，一起梳理创作思路");
    expect(html).not.toContain("生成前由你确认");
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
