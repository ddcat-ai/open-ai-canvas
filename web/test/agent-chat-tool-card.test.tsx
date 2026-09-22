import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentToolCard } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

test("automatic correction is neutral and collapsed, with recovery and exhaustion history", () => {
    for (const theme of [canvasThemes.dark, canvasThemes.light]) {
        for (const status of ["retrying", "recovered", "exhausted"]) {
            const html = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="缺少操作类型" detail={{ eventType: "tool_failed", retry: { groupId: "run:repair:call", attempt: 1, maxAttempts: 3, status }, retryAttempts: [{ id: "call", text: "缺少操作类型" }] }} theme={theme} />);
            expect(html).toContain("data-agent-tool-retry");
            expect(html).toContain("<summary");
            expect(html).not.toContain("open=");
            expect(html).not.toContain("#dc2626");
            expect(html).not.toContain("执行失败");
            expect(html).toContain("缺少操作类型");
            expect(html).toContain(status === "recovered" ? "自动纠正后已恢复" : status === "exhausted" ? "自动纠正未完成" : "自动纠正记录");
        }
    }
});

test("completed tools keep an accessible status without a duplicate visual badge", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="model_list" text="工具执行成功" detail={{ eventType: "tool_completed" }} theme={canvasThemes.dark} />);
    expect(html).toContain("已获取可用模型");
    expect(html).toContain('class="sr-only">已完成');
    expect(html).not.toContain("agent-tool-label");
});

test("empty read and operation events stay flat instead of rendering empty cards", () => {
    const readHtml = renderToStaticMarkup(<AgentToolCard title="model_list" text="工具执行成功" detail={{ eventType: "tool_completed" }} theme={canvasThemes.dark} />);
    const operationHtml = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={{ eventType: "canvas_updated" }} theme={canvasThemes.dark} />);
    expect(readHtml).toContain("agent-tool-row--plain");
    expect(operationHtml).toContain("agent-tool-row--plain");
});

test("canvas reads show one node by default and expose the collapsed count", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="canvas_get_state" text="已读取当前画布" detail={{ eventType: "tool_completed", result: { nodes: [
        { id: "node-1", title: "第一个节点", type: "image" },
        { id: "node-2", title: "第二个节点", type: "text" },
        { id: "node-3", title: "第三个节点", type: "video" },
    ] } }} theme={canvasThemes.dark} onFocusNode={() => {}} />);
    expect(html).toContain("读取了图片节点《第一个节点》");
    expect(html).not.toContain("读取了文本节点《第二个节点》");
    expect(html).toContain("已折叠 2 个节点，展开查看");
});

test("failed tools retain a visible failure label", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="model_list" text="无法获取" detail={{ eventType: "tool_failed" }} theme={canvasThemes.light} />);
    expect(html).toContain("agent-tool-label");
    expect(html).toContain("执行失败");
});

test("long skill references wrap rather than truncate", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="skill_read_file" text="工具执行成功" detail={{ eventType: "tool_completed", skillName: "novel-storyboard", path: "references/storyboard-pass.md" }} theme={canvasThemes.dark} />);
    expect(html).toContain("references/storyboard-pass.md");
    expect(html).toContain("break-words");
    expect(html).not.toContain("truncate");
});

test("failed media shows its error and task identifier without hovering", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="generate_media" text="上游拒绝该生成规格" detail={{ eventType: "tool_failed", result: { taskId: "task-123" } }} theme={canvasThemes.light} />);
    expect(html).toContain(">上游拒绝该生成规格</span>");
    expect(html).toContain("任务 ID：task-123");
});


test("canvas action trace is accessible and links to persisted node identities", () => {
    const html = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={{ eventType: "canvas_updated", actions: [{ action: "created", nodeId: "video-1", title: "满月动画", nodeType: "video" }, { action: "referenced", nodeId: "image-1", title: "满月照片", nodeType: "image" }] }} theme={canvasThemes.light} onFocusNode={() => {}} />);
    expect(html).toContain('data-agent-node-id="video-1"');
    expect(html).toContain('aria-label="在画布中定位满月动画"');
    expect(html).toContain("创建了视频节点《满月动画》");
    expect(html).toContain("引用了图片节点《满月照片》");
    expect(html).not.toContain('disabled=""');
});

test("failed media trace retains node title and collapsible upstream details", () => {
    const text = "上游拒绝规格：" + "错误详情".repeat(80);
    const html = renderToStaticMarkup(<AgentToolCard title="generate_media" text={text} detail={{ eventType: "tool_failed", arguments: JSON.stringify({ nodeId: "video-1", title: "满月动画", mode: "video" }), result: { taskId: "task-failed", taskSubmitted: true } }} theme={canvasThemes.light} onFocusNode={() => {}} />);
    expect(html).toContain("生成未完成：视频节点《满月动画》");
    expect(html).toContain("查看完整错误详情");
    expect(html).toContain("任务 ID：task-failed");
    expect(html).toContain("<details");
});
