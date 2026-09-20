import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type AgentCanvasAction = { nodeId: string; title: string; nodeType: string; action: string; fields?: string[]; resultTitle?: string; targetNodeId?: string; targetTitle?: string; targetNodeType?: string };

export function agentRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function agentToolArguments(detail: unknown) {
    const value = agentRecord(detail).arguments;
    if (typeof value !== "string") return agentRecord(value);
    try { return agentRecord(JSON.parse(value)); } catch { return {}; }
}

export function agentCanvasActions(toolName: string, detail: unknown, references: CanvasResourceReference[] = []): AgentCanvasAction[] {
    const payload = agentRecord(detail);
    const result = agentRecord(payload.result);
    const args = agentToolArguments(detail);
    const actions: AgentCanvasAction[] = [];
    const add = (id: unknown, title: unknown, kind: unknown, action: string, details: Partial<AgentCanvasAction> = {}) => {
        if (typeof id !== "string" || !id || actions.some((item) => item.nodeId === id && item.action === action)) return;
        const reference = references.find((item) => item.nodeId === id);
        actions.push({ nodeId: id, title: typeof title === "string" && title ? title : reference?.title || id, nodeType: typeof kind === "string" ? kind : reference?.kind || "", action, ...details });
    };
    if (Array.isArray(payload.actions)) {
        for (const value of payload.actions) {
            const action = agentRecord(value);
            add(action.nodeId, action.title, action.nodeType, String(action.action || "updated"), {
                fields: Array.isArray(action.fields) ? action.fields.filter((field): field is string => typeof field === "string") : undefined,
                resultTitle: typeof action.resultTitle === "string" ? action.resultTitle : undefined,
                targetNodeId: typeof action.targetNodeId === "string" ? action.targetNodeId : undefined,
                targetTitle: typeof action.targetTitle === "string" ? action.targetTitle : undefined,
                targetNodeType: typeof action.targetNodeType === "string" ? action.targetNodeType : undefined,
            });
        }
        return actions;
    }
    const failed = payload.eventType === "tool_failed";
    if (toolName === "generate_media") {
        const submitted = payload.eventType === "generation_task_created";
        const action = failed ? "failed" : submitted ? "generating" : "generated";
        add(result.nodeId || payload.nodeId || args.nodeId, payload.title || args.title, payload.mode || args.mode, action);
        if (!failed || result.taskSubmitted === true) {
            const ids = payload.referenceNodeIds || args.referenceNodeIds;
            if (Array.isArray(ids)) for (const id of ids) add(id, undefined, undefined, "referenced");
        }
    } else if (toolName === "canvas_get_state" && !failed && Array.isArray(result.nodes)) {
        for (const value of result.nodes) { const node = agentRecord(value); add(node.id, node.title, node.type, "read"); }
    } else if (toolName === "canvas_apply_ops" && !failed && Array.isArray(args.ops)) {
        for (const value of args.ops) {
            const op = agentRecord(value);
            if (op.type === "connect_nodes") {
                add(op.fromNodeId, undefined, undefined, "referenced");
                add(op.toNodeId, undefined, undefined, "updated");
            } else add(op.id, op.title, op.nodeType, op.type === "add_node" ? "created" : "updated");
        }
    }
    return actions;
}

export function agentCanvasActionLabel(action: AgentCanvasAction) {
    const kind = ({ image: "图片", video: "视频", audio: "音频", text: "文本", markdown: "Markdown", script: "分镜" } as Record<string, string>)[action.nodeType] || "";
    if (action.action === "referenced" && action.targetTitle) {
        const targetKind = ({ image: "图片", video: "视频", audio: "音频", text: "文本", markdown: "Markdown", script: "分镜" } as Record<string, string>)[action.targetNodeType || ""] || "";
        return `建立引用：${kind}节点《${action.title}》 → ${targetKind}节点《${action.targetTitle}》`;
    }
    const verb = ({ created: "创建了", updated: "更新了", referenced: "引用了", read: "读取了", generating: "已提交生成：", generated: "已生成", failed: "生成未完成：" } as Record<string, string>)[action.action] || "定位";
    const fieldText = action.fields?.length ? `（修改：${action.fields.join("、")}）` : "";
    const titleText = action.resultTitle ? `，名称改为《${action.resultTitle}》` : "";
    return `${verb}${kind}节点《${action.title}》${fieldText}${titleText}`;
}
