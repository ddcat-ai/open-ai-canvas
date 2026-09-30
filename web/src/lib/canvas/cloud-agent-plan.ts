import type { CloudAgentPlanItem, CloudAgentUserQuestion } from "@/components/canvas/canvas-cloud-agent-chat-ui";

type PlanCarrier = { planItems?: CloudAgentPlanItem[]; planTerminal?: boolean };

/**
 * 从对话消息流里挑出**当前该展示的那份**待办清单。
 *
 * 一个对话会跨多轮运行，**每轮各有一条** `plan-${runId}` 清单消息，它们都在同一个 messages
 * 数组里。这里必须取**最新**的那条：取第一条（`messages.find`）会把清单永远钉在第 1 轮的
 * 初始状态 —— 后面怎么推进都不刷新、全部做完也不消失（2026-09-16 实测反馈）。
 */
export function latestAgentPlanItems(messages: readonly PlanCarrier[]): CloudAgentPlanItem[] {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const items = messages[index].planItems;
        if (items?.length) return items;
    }
    return [];
}

/**
 * 计划清单可以在运行结束后仍保留未完成项。这个标记必须和清单一起
 * 持久化，否则从本地历史恢复时，未完成项会被误显示为仍在执行。
 */
export function latestAgentPlanTerminal(messages: readonly PlanCarrier[]): boolean {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const items = messages[index].planItems;
        if (items?.length) return messages[index].planTerminal === true;
    }
    return false;
}

/** 全部完成才收起清单；只要还有未开始/进行中，就一直占着输入框上方那一行。 */
export function agentPlanVisible(items: readonly CloudAgentPlanItem[]): boolean {
    return items.length > 0 && items.some((entry) => entry.status !== "done");
}

type QuestionCarrier = { role: string; question?: CloudAgentUserQuestion };

/**
 * 挑出**当前还没作答**的那道提问。
 *
 * 取最后一条带 question 的消息；如果它之后已经有用户消息，说明用户答过了，面板收起。
 *
 * 为什么需要它：运行中输入框是禁用的，模型在正文里提问用户根本答不了
 * （生产实测它连问 4 轮、白烧十几步）。`ask_user` 让本轮干净收尾并把问题结构化，
 * 这个选择器决定「现在该不该把选项面板亮给用户」。
 */
export function pendingAgentQuestion(messages: readonly QuestionCarrier[]): CloudAgentUserQuestion | undefined {
    let index = -1;
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
        if (messages[cursor].question) {
            index = cursor;
            break;
        }
    }
    if (index < 0) return undefined;
    // 之后只要出现过用户发言，就说明这道题已经答过了。
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
        if (messages[cursor].role === "user") return undefined;
    }
    return messages[index].question;
}
