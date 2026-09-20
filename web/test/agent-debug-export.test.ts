import { expect, test } from "bun:test";
import { buildAgentDebugExport } from "@/lib/canvas/agent-debug-export";

test("debug export preserves diagnostics and redacts nested credentials and signed media", () => {
    const text = buildAgentDebugExport({
        messages: [{ content: "生成失败：长度超限", taskId: "task-1" }],
        arguments: JSON.stringify({ prompt: "镜头1", apiKey: "private-key", references: ["https://user:pass@example.com/video?signature=private-signature#secret"] }),
        headers: { Authorization: "private-header" },
        token: "private-token",
        error: "Bearer private-bearer api_key=private-plain data:image/png;base64,private-media",
    });
    const exported = JSON.parse(text);
    expect(exported.format).toBe("canvas-agent-debug");
    expect(exported.messages[0].taskId).toBe("task-1");
    expect(JSON.parse(exported.arguments).prompt).toBe("镜头1");
    expect(text).toContain("https://example.com/video");
    expect(text).not.toContain("private-");
    expect(text).not.toContain("user:pass");
});
