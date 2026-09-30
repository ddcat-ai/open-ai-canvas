import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatMessage, rewriteAgentNodeLinks, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

const videoReference = {
    id: "video-1790385749473-q4157",
    nodeId: "video-1790385749473-q4157",
    kind: "video" as const,
    label: "片头镜头",
    title: "片头镜头",
    sourceType: "video" as const,
    previewUrl: "data:image/png;base64,preview",
};

function assistantMessage(text: string): CloudAgentChatMessage {
    return { id: "assistant-1", role: "assistant", text };
}

test("rewrites generated node IDs into semantic Markdown links", () => {
    const text = rewriteAgentNodeLinks("新节点 ID：video-1790385749473-q4157", [videoReference]);

    expect(text).toContain("新节点：[视频节点 · 片头镜头](#agent-node:video-1790385749473-q4157)");
    expect(text).not.toContain("新节点 ID");
    expect(text).not.toContain("video-1790385749473-q4157</a>");
});

test("does not mistake Agent task IDs for canvas nodes", () => {
    const text = "任务 ag293f6d7-55b6-4a25-8c4f-8c6b2c4d9b10 已创建";
    expect(rewriteAgentNodeLinks(text)).toBe(text);
});

test("falls back to a node type label and URL-encodes exact reference IDs", () => {
    const nodeId = "video-custom:take-1";
    const text = rewriteAgentNodeLinks(nodeId, [{ ...videoReference, id: nodeId, nodeId, title: "自定义镜头", label: "自定义镜头" }]);

    expect(text).toContain("[视频节点 · 自定义镜头](#agent-node:video-custom%3Atake-1)");
    expect(rewriteAgentNodeLinks("video-123")).toContain("[视频节点](#agent-node:video-123)");
});

test("leaves fenced code blocks untouched", () => {
    const text = "```text\nvideo-1790385749473-q4157\n```\nvideo-1790385749473-q4157";
    const rewritten = rewriteAgentNodeLinks(text, [videoReference]);

    expect(rewritten).toContain("```text\nvideo-1790385749473-q4157\n```");
    expect(rewritten).toContain("[视频节点 · 片头镜头](#agent-node:video-1790385749473-q4157)");
});

test("renders an agent node link as a titled inline node card", () => {
    const html = renderToStaticMarkup(
        <AgentChatMessage
            item={assistantMessage("新节点 ID：video-1790385749473-q4157")}
            theme={canvasThemes.dark}
            references={[videoReference]}
            onFocusNode={() => {}}
        />,
    );
    const visibleText = html.replace(/<[^>]+>/gu, "");

    expect(html).toContain('class="agent-message-node-link"');
    expect(html).toContain('data-agent-node-id="video-1790385749473-q4157"');
    expect(html).toContain("视频节点");
    expect(html).toContain("片头镜头");
    expect(visibleText).not.toContain("video-1790385749473-q4157");
});
