import { expect, test } from "bun:test";
import { submitCreationAgentInterjection, upsertCreationAgentInterjection } from "../src/pages/create/creation-agent-interjection";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";
import type { AgentEvent, AgentRun } from "../src/services/api/agent";

const at = "2026-10-20T10:00:00Z";
const baseRun: AgentRun = { id: "run", sessionId: "session", surface: "creation", canvasId: "", status: "running", permissionMode: "auto", userPrompt: "套图", createdAt: at, updatedAt: at };
const initial = (): CreationConversation => ({ id: "conversation", title: "套图", updatedAt: at, messages: [], agentSessionId: "session", agentRunId: "run", agentRuns: [baseRun] });
const receipt = (type = "user_interjection", seq = 1): AgentEvent => ({ runId: "run", seq, type, eventId: `e${seq}`, createdAt: at, payload: { messageId: "stable", text: "背景改成蓝色" } });
function fixture() {
    let conversation = initial();
    let run = { ...baseRun, eventCount: 0, events: [] as AgentEvent[] };
    let scope = "owner";
    const sends: Array<{ runId: string; messageId: string; text: string }> = [];
    const reads: number[] = [];
    const saved: CreationMessage[] = [];
    const client = {
        assertCurrent: () => {
            if (scope !== "owner") throw new Error("账号已切换");
        },
        createId: () => "stable",
        read: async (_id: string, after: number) => {
            reads.push(after);
            return { ...run, events: run.events.filter((event) => event.seq > after).slice(0, 1) };
        },
        save: async (message: CreationMessage) => {
            saved.push(message);
            conversation = upsertCreationAgentInterjection(conversation, message);
        },
        send: async (runId: string, input: { messageId: string; text: string }) => {
            expect(saved.some((message) => message.id === input.messageId && message.agentInterjection === "pending")).toBe(true);
            sends.push({ runId, ...input });
            run = { ...run, events: [receipt()], eventCount: 1 };
            return { accepted: true, pending: 1 };
        },
    };
    return {
        client,
        sends,
        reads,
        saved,
        conversation: () => conversation,
        setRun: (value: Partial<typeof run>) => {
            run = { ...run, ...value };
        },
        switchAccount: () => {
            scope = "another";
        },
    };
}

test("提交到原 run，写入稳定身份后才发请求，待审批只标为排队", async () => {
    const f = fixture();
    f.setRun({ status: "waiting_approval" });
    const result = await submitCreationAgentInterjection({ conversation: f.conversation(), text: "背景改成蓝色" }, f.client);
    expect(f.sends).toEqual([{ runId: "run", messageId: "stable", text: "背景改成蓝色" }]);
    expect(result.message.agentInterjection).toBe("queued");
    expect(result.run.status).toBe("waiting_approval");
    expect(f.conversation().messages).toHaveLength(1);
    expect(f.conversation().agentRunId).toBe("run");
});

test("请求已接受但回执丢失，重载后分页核对原消息，不再提交", async () => {
    const f = fixture();
    const send = f.client.send;
    let disconnected = true;
    const read = f.client.read;
    f.client.read = async (...args) => {
        if (f.sends.length && disconnected) throw new Error("离线");
        return read(...args);
    };
    f.client.send = async (...args) => {
        await send(...args);
        throw new Error("回执超时");
    };
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "背景改成蓝色" }, f.client)).rejects.toThrow();
    const restored: CreationConversation = JSON.parse(JSON.stringify(f.conversation()));
    expect(restored.messages[0].agentInterjection).toBe("pending");
    disconnected = false;
    f.setRun({ events: [{ ...receipt("assistant_message"), payload: { text: "已了解" } }, receipt("user_interjection", 2), receipt("user_interjection_delivered", 3)], eventCount: 3, status: "completed" });
    const result = await submitCreationAgentInterjection({ conversation: restored, messageId: "stable" }, f.client);
    expect(result.message.agentInterjection).toBe("delivered");
    expect(f.sends).toHaveLength(1);
    expect(f.reads).toContain(2);
});

test("回执不明且服务端未收下时重放同一 ID；新内容不能偷换原请求", async () => {
    const f = fixture();
    const send = f.client.send;
    f.client.send = async () => {
        throw new Error("断网");
    };
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "背景改成蓝色" }, f.client)).rejects.toThrow();
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "改成红色" }, f.client)).rejects.toThrow("待确认");
    f.client.send = send;
    const result = await submitCreationAgentInterjection({ conversation: f.conversation(), text: "背景改成蓝色" }, f.client);
    expect(result.message.id).toBe("stable");
    expect(f.sends).toHaveLength(1);
    expect(f.conversation().messages).toHaveLength(1);
});

test("原 run 已结束且确认没有接受时显示未送达，不自动创建新 run", async () => {
    const f = fixture();
    f.client.send = async () => {
        f.setRun({ status: "completed" });
        throw new Error("409");
    };
    const result = await submitCreationAgentInterjection({ conversation: f.conversation(), text: "背景改成蓝色" }, f.client);
    expect(result.message.agentInterjection).toBe("undelivered");
    expect(f.conversation().agentRunId).toBe("run");
    expect(f.conversation().messages[0].content).toBe("背景改成蓝色");
});

test("新增附件、错误 session/画布 run 与清理中状态均不发送、不消费草稿", async () => {
    const f = fixture();
    const attachment = { id: "image", type: "image/png", name: "新图", storageKey: "resource:image", previewUrl: "/image.png" };
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "结合新图", attachments: [attachment] }, f.client)).rejects.toThrow("附件");
    for (const patch of [{ canvasId: "canvas" }, { surface: "canvas" }, { sessionId: "other" }, { cleanupPending: true }]) {
        f.setRun({ ...baseRun, ...patch });
        await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "补充" }, f.client)).rejects.toThrow();
    }
    expect(f.sends).toHaveLength(0);
    expect(f.saved).toHaveLength(0);
});

test("本地身份写入失败或保存期间切换账号，不允许发送", async () => {
    const f = fixture();
    f.client.save = async () => {
        throw new Error("缓存写入失败");
    };
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "补充" }, f.client)).rejects.toThrow("缓存写入失败");
    f.client.save = async () => {
        f.switchAccount();
    };
    await expect(submitCreationAgentInterjection({ conversation: f.conversation(), text: "补充" }, f.client)).rejects.toThrow("账号已切换");
    expect(f.sends).toHaveLength(0);
});

test("较迟的 HTTP 排队回执不会覆盖 SSE 的已送达/未送达状态", () => {
    const current = initial();
    const message: CreationMessage = { id: "stable", role: "user", mode: "agent", content: "补充", agentRunId: "run", agentInterjection: "delivered", createdAt: at };
    expect(upsertCreationAgentInterjection({ ...current, messages: [message] }, { ...message, agentInterjection: "queued" }).messages[0].agentInterjection).toBe("delivered");
});
